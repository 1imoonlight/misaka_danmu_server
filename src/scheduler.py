import asyncio
import importlib
import inspect
import logging
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Type
from uuid import uuid4

import aiomysql
from apscheduler.events import EVENT_JOB_EXECUTED, EVENT_JOB_ERROR, JobExecutionEvent
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from . import crud
from .jobs.base import BaseJob
from .task_manager import TaskManager

logger = logging.getLogger(__name__)

# --- Scheduler Manager ---

class SchedulerManager:
    def __init__(self, pool: aiomysql.Pool, task_manager: TaskManager):
        self.pool = pool
        self.task_manager = task_manager
        self.scheduler = AsyncIOScheduler(timezone="Asia/Shanghai")
        self._job_classes: Dict[str, Type[BaseJob]] = {}

    def _load_jobs(self):
        """
        动态发现并加载 'jobs' 目录下的所有任务类。
        """
        jobs_dir = Path(__file__).parent / "jobs"
        for file in jobs_dir.glob("*.py"):
            if file.name.startswith("_") or file.name == "base.py":
                continue

            module_name = f".jobs.{file.stem}"
            try:
                module = importlib.import_module(module_name, package="src")
                for name, obj in inspect.getmembers(module, inspect.isclass):
                    if issubclass(obj, BaseJob) and obj is not BaseJob:
                        if obj.job_type in self._job_classes:
                            logger.warning(f"发现重复的定时任务类型 '{obj.job_type}'。将被覆盖。")
                        self._job_classes[obj.job_type] = obj
                        logger.info(f"定时任务 '{obj.job_name}' (类型: {obj.job_type}) 已加载。")
            except Exception as e:
                logger.error(f"从 {file.name} 加载定时任务失败: {e}")

    def get_available_jobs(self) -> List[Dict[str, str]]:
        """获取所有已加载的可用任务类型及其名称。"""
        return [{"type": job.job_type, "name": job.job_name} for job in self._job_classes.values()]

    def _create_job_runner(self, job_type: str) -> Callable:
        """创建一个包装器，用于在 TaskManager 中运行任务，并等待其完成。"""
        job_class = self._job_classes[job_type]
        
        async def runner():
            job_instance = job_class(self.pool)
            task_coro_factory = lambda callback: job_instance.run(callback)
            task_id, done_event = await self.task_manager.submit_task(task_coro_factory, job_instance.job_name)
            # The apscheduler job now waits for the actual task to complete.
            await done_event.wait()
            logger.info(f"定时任务的运行器已确认任务 '{job_instance.job_name}' (ID: {task_id}) 执行完毕。")
        
        return runner

    async def _handle_job_event(self, event: JobExecutionEvent):
        job = self.scheduler.get_job(event.job_id)
        if job:
            await crud.update_scheduled_task_run_times(self.pool, job.id, job.last_run_time, job.next_run_time)

    async def start(self):
        self._load_jobs()
        self.scheduler.add_listener(self._handle_job_event, EVENT_JOB_EXECUTED | EVENT_JOB_ERROR)
        self.scheduler.start()
        await self.load_jobs_from_db()
        logger.info("定时任务调度器已启动。")

    async def stop(self):
        self.scheduler.shutdown()

    async def load_jobs_from_db(self):
        tasks = await crud.get_scheduled_tasks(self.pool)
        for task in tasks:
            if task['job_type'] in self._job_classes:
                try:
                    runner = self._create_job_runner(task['job_type'])
                    job = self.scheduler.add_job(runner, CronTrigger.from_crontab(task['cron_expression']), id=task['id'], name=task['name'], replace_existing=True)
                    if not task['is_enabled']: self.scheduler.pause_job(task['id'])
                    # When loading, the job object is new and has no last_run_time. We only need to update the next_run_time.
                    await crud.update_scheduled_task_run_times(self.pool, job.id, task['last_run_at'], job.next_run_time)
                except Exception as e:
                    logger.error(f"加载定时任务 '{task['name']}' (ID: {task['id']}) 失败: {e}")

    async def get_all_tasks(self) -> List[Dict[str, Any]]:
        """从数据库获取所有定时任务的列表。"""
        return await crud.get_scheduled_tasks(self.pool)

    async def add_task(self, name: str, job_type: str, cron: str, is_enabled: bool) -> Dict[str, Any]:
        if job_type not in self._job_classes:
            raise ValueError(f"未知的任务类型: {job_type}")
        task_id = str(uuid4())
        await crud.create_scheduled_task(self.pool, task_id, name, job_type, cron, is_enabled)
        runner = self._create_job_runner(job_type)
        job = self.scheduler.add_job(runner, CronTrigger.from_crontab(cron), id=task_id, name=name)
        if not is_enabled: job.pause()
        await crud.update_scheduled_task_run_times(self.pool, task_id, None, job.next_run_time)
        return await crud.get_scheduled_task(self.pool, task_id)

    async def update_task(self, task_id: str, name: str, cron: str, is_enabled: bool) -> Optional[Dict[str, Any]]:
        if not (job := self.scheduler.get_job(task_id)): return None
        await crud.update_scheduled_task(self.pool, task_id, name, cron, is_enabled)
        job.modify(name=name)
        job.reschedule(trigger=CronTrigger.from_crontab(cron))
        if is_enabled: job.resume()
        else: job.pause()
        await crud.update_scheduled_task_run_times(self.pool, task_id, job.last_run_time, job.next_run_time)
        return await crud.get_scheduled_task(self.pool, task_id)

    async def delete_task(self, task_id: str):
        if self.scheduler.get_job(task_id): self.scheduler.remove_job(task_id)
        await crud.delete_scheduled_task(self.pool, task_id)

    async def run_task_now(self, task_id: str):
        if job := self.scheduler.get_job(task_id):
            job.modify(next_run_time=datetime.now(self.scheduler.timezone))
        else:
            raise ValueError("找不到指定的任务ID")