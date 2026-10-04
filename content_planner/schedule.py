"""กระจายคลิปลงวันโพสต์ทั้งเดือน โดยโพสต์หลังวันถ่าย + เวลาตัดต่อเสมอ"""

from __future__ import annotations

import calendar
from datetime import date, timedelta

from .model import Plan, PlanError


def post_slots(plan: Plan) -> list[date]:
    days = calendar.monthrange(plan.year, plan.month)[1]
    return [d for d in (date(plan.year, plan.month, n) for n in range(1, days + 1))
            if d.weekday() in plan.post_days]


def assign(plan: Plan) -> Plan:
    """ใส่ post_date ให้ทุกคลิป คลิปจากการลงพื้นที่ครั้งแรกได้คิวก่อน"""
    free = post_slots(plan)
    order = sorted(plan.ideas, key=lambda i: plan.visit(i.visit).date)  # stable: คงลำดับในไฟล์
    late = []
    for idea in order:
        ready = plan.visit(idea.visit).date + timedelta(days=plan.edit_days)
        slot = next((d for d in free if d >= ready), None)
        if slot is None:
            late.append(idea.id)
            continue
        free.remove(slot)
        idea.post_date = slot
    if late:
        raise PlanError([
            f"วันโพสต์ในเดือน {plan.label} ไม่พอสำหรับคลิป {', '.join(late)} "
            f"(มี {len(post_slots(plan))} วันโพสต์) เพิ่ม post_days หรือย้ายวันลงพื้นที่ให้เร็วขึ้น"
        ])
    return plan
