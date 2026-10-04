import copy
import csv
import io
import json
import os
import tempfile
import unittest
from datetime import date

from content_planner import model, render, schedule
from content_planner.__main__ import main

EXAMPLE = os.path.join(os.path.dirname(__file__), "..", "examples", "ideas-2026-11.json")


def example() -> dict:
    with open(EXAMPLE, encoding="utf-8") as f:
        return json.load(f)


def errors_for(data: dict) -> list[str]:
    try:
        model.parse(data)
    except model.PlanError as e:
        return e.errors
    raise AssertionError("expected PlanError")


class ParseTest(unittest.TestCase):
    def test_example_is_valid(self):
        plan = model.parse(example())
        self.assertEqual(plan.label, "2026-11")
        self.assertEqual(len(plan.ideas), 3)
        self.assertEqual(plan.ideas[1].hook, "เห็นก้อนปูนเล็กๆ ใต้เหล็กไหม? ห้ามขาดเด็ดขาด")

    def test_hashtags_normalized_and_merged_with_defaults(self):
        plan = model.parse(example())
        self.assertEqual(plan.ideas[1].hashtags, ["#ความรู้ช่าง", "#งานก่อสร้าง", "#ช่างไทย"])

    def test_missing_hook_caption_hashtags_and_shots(self):
        data = example()
        data["default_hashtags"] = []
        idea = data["ideas"][0]
        idea.update(hook="", caption="", hashtags=[], shots=[])
        errs = "\n".join(errors_for(data))
        for word in ("hook", "แคปชั่น", "แฮชแท็ก", "shot list"):
            self.assertIn(word, errs)

    def test_hook_longer_than_3_seconds(self):
        data = example()
        data["ideas"][0]["hook"]["seconds"] = 5
        self.assertIn("เกิน 3 วิ", errors_for(data)[0])

    def test_duration_out_of_range(self):
        for bad in (10, 61):
            data = example()
            data["ideas"][0]["duration"] = bad
            self.assertIn("15-60", errors_for(data)[0])

    def test_more_than_three_visits(self):
        data = example()
        data["visits"] += [{"id": f"x{n}", "date": "2026-11-20"} for n in range(2)]
        self.assertIn("เกินเป้า", errors_for(data)[0])

    def test_unknown_visit_and_duplicate_id(self):
        data = example()
        data["ideas"][1]["visit"] = "nope"
        data["ideas"][1]["id"] = "C01"
        errs = "\n".join(errors_for(data))
        self.assertIn('visit "nope"', errs)
        self.assertIn("id คลิปซ้ำกัน: C01", errs)

    def test_bad_month(self):
        data = example()
        data["month"] = "พ.ย."
        self.assertIn("YYYY-MM", errors_for(data)[0])


class ScheduleTest(unittest.TestCase):
    def test_posts_only_on_post_days_after_edit_time(self):
        plan = schedule.assign(model.parse(example()))
        dates = {i.id: i.post_date for i in plan.ideas}
        # v1 ถ่าย 2 พ.ย. (จ.) ตัดต่อ 1 วัน -> พ. 4, ศ. 6
        self.assertEqual(dates["C01"], date(2026, 11, 4))
        self.assertEqual(dates["C02"], date(2026, 11, 6))
        # v2 ถ่าย 14 พ.ย. (ส.) -> จ. 16
        self.assertEqual(dates["C03"], date(2026, 11, 16))
        for d in dates.values():
            self.assertIn(d.weekday(), plan.post_days)

    def test_not_enough_slots(self):
        data = example()
        data["post_days"] = ["sun"]
        data["visits"][1]["date"] = "2026-11-29"  # อา. สุดท้ายของเดือน ตัดต่อไม่ทัน
        with self.assertRaises(model.PlanError) as ctx:
            schedule.assign(model.parse(data))
        self.assertIn("C03", ctx.exception.errors[0])


class RenderTest(unittest.TestCase):
    def setUp(self):
        self.plan = schedule.assign(model.parse(example()))

    def test_markdown_groups_shots_by_visit(self):
        md = render.markdown(self.plan)
        v1 = md.index("บ้านเดี่ยว 2 ชั้น")
        v2 = md.index("รีโนเวทห้องน้ำ (1 คลิป)")
        self.assertLess(v1, md.index("**C02** โคลสอัพลูกปูนใต้เหล็ก"))
        self.assertLess(md.index("**C02** โคลสอัพลูกปูนใต้เหล็ก"), v2)
        self.assertIn("| พ. 2026-11-04 | 19:00 | C01 |", md)
        self.assertIn("9:16", md)

    def test_csv_rows_sorted_by_date(self):
        rows = list(csv.DictReader(io.StringIO(render.schedule_csv(self.plan))))
        self.assertEqual([r["clip"] for r in rows], ["C01", "C02", "C03"])
        self.assertEqual(rows[2]["site"], "รีโนเวทห้องน้ำ")


class CliTest(unittest.TestCase):
    def test_writes_plan_files(self):
        with tempfile.TemporaryDirectory() as out:
            self.assertEqual(main([EXAMPLE, "-o", out]), 0)
            self.assertEqual(sorted(os.listdir(out)), ["plan-2026-11.md", "schedule-2026-11.csv"])

    def test_check_fails_on_bad_file(self):
        data = copy.deepcopy(example())
        data["ideas"][0]["duration"] = 90
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        try:
            self.assertEqual(main([f.name, "--check"]), 1)
        finally:
            os.unlink(f.name)


if __name__ == "__main__":
    unittest.main()
