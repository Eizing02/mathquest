from __future__ import annotations

import argparse
import json
from collections import deque
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "assets" / "pets" / "manifest.json"
OUTPUT_DIR = ROOT / "assets" / "pets" / "sheets-normalized"
REPORT_PATH = ROOT / "output" / "pet-normalization-report.json"

ALPHA_THRESHOLD = 6
SEARCH_PAD = 96
SOURCE_PAD = 5
MIN_COMPONENT_AREA = 80

STAGE_PROFILES = {
    0: {"target_w": 0.66, "target_h": 0.66, "max_upscale": 1.18, "y_bias": 10},
    1: {"target_w": 0.78, "target_h": 0.78, "max_upscale": 1.06, "y_bias": 6},
    2: {"target_w": 0.84, "target_h": 0.82, "max_upscale": 1.00, "y_bias": 0},
}


def alpha_components(alpha: Image.Image) -> list[dict]:
    width, height = alpha.size
    px = alpha.load()
    seen = bytearray(width * height)
    components: list[dict] = []

    for y in range(height):
        row = y * width
        for x in range(width):
            idx = row + x
            if seen[idx] or px[x, y] <= ALPHA_THRESHOLD:
                continue

            seen[idx] = 1
            queue = deque([(x, y)])
            area = 0
            sum_x = 0
            sum_y = 0
            min_x = max_x = x
            min_y = max_y = y

            while queue:
                cx, cy = queue.popleft()
                area += 1
                sum_x += cx
                sum_y += cy
                if cx < min_x:
                    min_x = cx
                if cx > max_x:
                    max_x = cx
                if cy < min_y:
                    min_y = cy
                if cy > max_y:
                    max_y = cy

                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if nx < 0 or ny < 0 or nx >= width or ny >= height:
                        continue
                    nidx = ny * width + nx
                    if seen[nidx] or px[nx, ny] <= ALPHA_THRESHOLD:
                        continue
                    seen[nidx] = 1
                    queue.append((nx, ny))

            if area >= MIN_COMPONENT_AREA:
                components.append(
                    {
                        "area": area,
                        "bbox": (min_x, min_y, max_x + 1, max_y + 1),
                        "center": (sum_x / area, sum_y / area),
                    }
                )

    return components


def intersects(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> bool:
    return not (a[2] <= b[0] or a[0] >= b[2] or a[3] <= b[1] or a[1] >= b[3])


def select_frame_bbox(
    sheet: Image.Image,
    col: int,
    row: int,
    cell_w: int,
    cell_h: int,
) -> tuple[int, int, int, int]:
    sheet_w, sheet_h = sheet.size
    cell_box = (col * cell_w, row * cell_h, (col + 1) * cell_w, (row + 1) * cell_h)
    expected_center = ((cell_box[0] + cell_box[2]) / 2, (cell_box[1] + cell_box[3]) / 2)
    search_box = (
        max(0, cell_box[0] - SEARCH_PAD),
        max(0, cell_box[1] - SEARCH_PAD),
        min(sheet_w, cell_box[2] + SEARCH_PAD),
        min(sheet_h, cell_box[3] + SEARCH_PAD),
    )

    search_alpha = sheet.crop(search_box).getchannel("A")
    components = alpha_components(search_alpha)
    candidates = []
    largest_area = max((component["area"] for component in components), default=0)
    min_candidate_area = max(MIN_COMPONENT_AREA, largest_area * 0.12)

    for component in components:
        if component["area"] < min_candidate_area:
            continue
        left, top, right, bottom = component["bbox"]
        global_bbox = (
            left + search_box[0],
            top + search_box[1],
            right + search_box[0],
            bottom + search_box[1],
        )
        center_x = component["center"][0] + search_box[0]
        center_y = component["center"][1] + search_box[1]
        center_inside = (
            cell_box[0] - 28 <= center_x <= cell_box[2] + 28
            and cell_box[1] - 28 <= center_y <= cell_box[3] + 28
        )
        if not center_inside and not intersects(global_bbox, cell_box):
            continue

        dx = center_x - expected_center[0]
        dy = center_y - expected_center[1]
        distance = (dx * dx + dy * dy) ** 0.5
        area_bonus = min(component["area"], 60000) / 60000 * 36
        candidates.append((distance - area_bonus, global_bbox))

    if candidates:
        candidates.sort(key=lambda item: item[0])
        left, top, right, bottom = candidates[0][1]
    else:
        cell = sheet.crop(cell_box).getchannel("A")
        bbox = cell.getbbox()
        if not bbox:
            return cell_box
        left, top, right, bottom = (
            bbox[0] + cell_box[0],
            bbox[1] + cell_box[1],
            bbox[2] + cell_box[0],
            bbox[3] + cell_box[1],
        )

    return (
        max(0, left - SOURCE_PAD),
        max(0, top - SOURCE_PAD),
        min(sheet_w, right + SOURCE_PAD),
        min(sheet_h, bottom + SOURCE_PAD),
    )


def output_alpha_bbox(frame: Image.Image) -> tuple[int, int, int, int] | None:
    return frame.getchannel("A").getbbox()


def normalize_pet(pet: dict, manifest: dict) -> dict:
    cell_w = int(pet.get("cellWidth") or manifest["cellWidth"])
    cell_h = int(pet.get("cellHeight") or manifest["cellHeight"])
    columns = int(pet.get("columns") or manifest["columns"])
    rows = int(pet.get("rows") or manifest["rows"])
    source_path = ROOT / pet.get("rawSheet", pet["sheet"])
    sheet = Image.open(source_path).convert("RGBA")

    extracted: list[list[dict]] = []
    for row in range(rows):
        row_frames = []
        for col in range(columns):
            bbox = select_frame_bbox(sheet, col, row, cell_w, cell_h)
            frame = sheet.crop(bbox)
            alpha_bbox = output_alpha_bbox(frame)
            if alpha_bbox:
                frame = frame.crop(alpha_bbox)
            row_frames.append({"source_bbox": bbox, "frame": frame})
        extracted.append(row_frames)

    out = Image.new("RGBA", (cell_w * columns, cell_h * rows), (0, 0, 0, 0))
    report_rows = []

    for row, row_frames in enumerate(extracted):
        profile = STAGE_PROFILES.get(row, STAGE_PROFILES[2])
        max_w = max(item["frame"].size[0] for item in row_frames)
        max_h = max(item["frame"].size[1] for item in row_frames)
        scale = min(
            (cell_w * profile["target_w"]) / max(max_w, 1),
            (cell_h * profile["target_h"]) / max(max_h, 1),
            profile["max_upscale"],
        )

        frame_reports = []
        for col, item in enumerate(row_frames):
            frame = item["frame"]
            new_w = max(1, round(frame.size[0] * scale))
            new_h = max(1, round(frame.size[1] * scale))
            resized = frame.resize((new_w, new_h), Image.Resampling.LANCZOS)

            x = round(col * cell_w + (cell_w - new_w) / 2)
            y = round(row * cell_h + (cell_h - new_h) / 2 + profile["y_bias"])
            x = max(col * cell_w + 6, min(x, (col + 1) * cell_w - new_w - 6))
            y = max(row * cell_h + 6, min(y, (row + 1) * cell_h - new_h - 6))

            out.alpha_composite(resized, (x, y))
            frame_bbox = (x - col * cell_w, y - row * cell_h, x - col * cell_w + new_w, y - row * cell_h + new_h)
            margins = (
                frame_bbox[0],
                frame_bbox[1],
                cell_w - frame_bbox[2],
                cell_h - frame_bbox[3],
            )
            frame_reports.append(
                {
                    "frame": col + 1,
                    "source_bbox": item["source_bbox"],
                    "size": [new_w, new_h],
                    "margins": margins,
                }
            )

        report_rows.append(
            {
                "stage": row + 1,
                "scale": round(scale, 4),
                "max_source_size": [max_w, max_h],
                "frames": frame_reports,
            }
        )

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / f"{pet['id']}.png"
    out.save(output_path, optimize=True)

    return {
        "id": pet["id"],
        "source": str(source_path.relative_to(ROOT)).replace("\\", "/"),
        "output": str(output_path.relative_to(ROOT)).replace("\\", "/"),
        "rows": report_rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Normalize MathQuest pet sprite sheets.")
    parser.add_argument("--report", default=str(REPORT_PATH), help="Path for the JSON normalization report.")
    args = parser.parse_args()

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    reports = [normalize_pet(pet, manifest) for pet in manifest["pets"]]

    report_path = Path(args.report)
    if not report_path.is_absolute():
        report_path = ROOT / report_path
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps({"pets": reports}, ensure_ascii=False, indent=2), encoding="utf-8")

    worst_margin = min(
        min(frame["margins"])
        for pet in reports
        for row in pet["rows"]
        for frame in row["frames"]
    )
    print(f"normalized {len(reports)} pet sheets -> {OUTPUT_DIR.relative_to(ROOT)}")
    print(f"report -> {report_path.relative_to(ROOT)}")
    print(f"minimum output margin: {worst_margin}px")


if __name__ == "__main__":
    main()
