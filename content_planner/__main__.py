"""python -m content_planner ideas.json [-o โฟลเดอร์] [--check]"""

from __future__ import annotations

import argparse
import os
import sys

from . import model, render, schedule


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="content_planner",
                                description="สร้างแผนคลิป TikTok รายเดือนจากไฟล์ไอเดีย (JSON)")
    p.add_argument("ideas", help="ไฟล์ไอเดีย .json")
    p.add_argument("-o", "--out", default=".", help="โฟลเดอร์ที่จะเขียนไฟล์แผน (ค่าเริ่มต้น: โฟลเดอร์ปัจจุบัน)")
    p.add_argument("--check", action="store_true", help="ตรวจไฟล์อย่างเดียว ไม่เขียนไฟล์")
    args = p.parse_args(argv)

    try:
        plan = schedule.assign(model.load(args.ideas))
    except model.PlanError as e:
        print("แผนยังไม่ผ่าน:", file=sys.stderr)
        for err in e.errors:
            print(f"  - {err}", file=sys.stderr)
        return 1

    if args.check:
        print(f"ผ่าน: {len(plan.ideas)} คลิป จากการลงพื้นที่ {len(plan.visits)} ครั้ง")
        return 0

    os.makedirs(args.out, exist_ok=True)
    md = os.path.join(args.out, f"plan-{plan.label}.md")
    csv_path = os.path.join(args.out, f"schedule-{plan.label}.csv")
    with open(md, "w", encoding="utf-8") as f:
        f.write(render.markdown(plan))
    with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:  # BOM ให้ Excel อ่านภาษาไทยได้
        f.write(render.schedule_csv(plan))
    print(f"เขียน {md}")
    print(f"เขียน {csv_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
