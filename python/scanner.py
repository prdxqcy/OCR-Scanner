import json
import queue
import re
import sys
import threading
import time
from dataclasses import dataclass
from typing import Optional

import mss
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter, ImageOps
from rapidocr_onnxruntime import RapidOCR


NUMBER_PATTERN = re.compile(r"-?\d+(?:[.,]\d+)?")
INTEGER_PATTERN = re.compile(r"(?<![\d.,])-?\d+(?![\d.,])")
NUMERIC_ONLY_PATTERN = re.compile(r"[^0-9.,\- ]+")
CHAR_TRANSLATIONS = str.maketrans(
    {
        "O": "0",
        "o": "0",
        "I": "1",
        "l": "1",
        "|": "1",
        "S": "5",
        "B": "8",
    }
)


@dataclass
class ScannerConfig:
    trackers: dict
    poll_interval_ms: int = 650
    scanner_enabled: bool = True


config = ScannerConfig(trackers={})
config_lock = threading.Lock()
command_queue: "queue.Queue[dict]" = queue.Queue()
ocr = RapidOCR()


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def resize_image(image: Image.Image, scale: int) -> Image.Image:
    width = max(1, image.width * scale)
    height = max(1, image.height * scale)
    return image.resize((width, height), Image.Resampling.LANCZOS)


def pad_region(region: dict) -> dict:
    pad_x = max(4, int(region["width"] * 0.08))
    pad_y = max(3, int(region["height"] * 0.14))

    left = max(0, int(region["x"]) - pad_x)
    top = max(0, int(region["y"]) - pad_y)
    right = int(region["x"]) + int(region["width"]) + pad_x
    bottom = int(region["y"]) + int(region["height"]) + pad_y

    return {
        "left": left,
        "top": top,
        "width": max(1, right - left),
        "height": max(1, bottom - top),
    }


def focus_crystals_region(image: Image.Image) -> Image.Image:
    width, height = image.size
    if width < 12 or height < 12:
        return image

    # Bias crystals toward the count area and away from the icon artwork.
    left = max(0, int(width * 0.42))
    top = max(0, int(height * 0.08))
    right = min(width, int(width * 0.98))
    bottom = min(height, int(height * 0.92))

    if right - left < 6 or bottom - top < 6:
        return image

    return image.crop((left, top, right, bottom))


def build_ocr_variants(image: Image.Image) -> list[np.ndarray]:
    gray = ImageOps.grayscale(image)
    contrasted = ImageOps.autocontrast(gray)
    sharpened = ImageEnhance.Sharpness(contrasted).enhance(2.2)
    boosted = ImageEnhance.Contrast(sharpened).enhance(2.0)
    filtered = boosted.filter(ImageFilter.MedianFilter(size=3))

    variants = [
        resize_image(image, 4),
        resize_image(contrasted, 4),
        resize_image(boosted, 4),
        resize_image(filtered, 4),
    ]

    for threshold in (90, 120, 150, 180, 210):
        binary = boosted.point(lambda pixel, cutoff=threshold: 255 if pixel > cutoff else 0)
        enlarged = resize_image(binary, 4)
        variants.append(enlarged)
        variants.append(ImageOps.invert(enlarged))

    return [np.array(variant) for variant in variants]


def extract_text(result: list | None) -> str:
    parts = []
    if result:
        for item in result:
            text = item[1]
            if text is None:
                continue
            normalized = str(text).strip()
            if normalized:
                parts.append(normalized)
    return " ".join(parts).strip()


def normalize_numeric_text(raw_text: str) -> str:
    return raw_text.translate(CHAR_TRANSLATIONS)


def apply_numeric_only_mode(raw_text: str) -> str:
    collapsed = NUMERIC_ONLY_PATTERN.sub(" ", raw_text)
    return " ".join(collapsed.split())


def pick_best_candidate(matches: list[str], previous_value: Optional[float]) -> Optional[float]:
    candidates: list[tuple[float, bool, int]] = []

    for match in matches:
        candidate = match.replace(",", ".")
        try:
            numeric_value = float(candidate)
        except ValueError:
            continue

        is_integer_like = "." not in candidate or numeric_value.is_integer()
        digit_count = sum(1 for char in candidate if char.isdigit())
        candidates.append((numeric_value, is_integer_like, digit_count))

    if not candidates:
        return None

    integer_candidates = [entry for entry in candidates if entry[1]]
    ranked_pool = integer_candidates or candidates

    if previous_value is not None:
        ranked_pool.sort(key=lambda entry: (abs(entry[0] - previous_value), -entry[2], -entry[0]))
    else:
        ranked_pool.sort(key=lambda entry: (not entry[1], -entry[2], -entry[0]))

    return ranked_pool[0][0]


def pick_best_integer_candidate(matches: list[str], previous_value: Optional[float]) -> Optional[float]:
    candidates: list[tuple[float, int]] = []

    for match in matches:
        digits_only = "".join(char for char in match if char.isdigit())
        if len(digits_only) == 0 or len(digits_only) > 9:
            continue

        try:
            numeric_value = float(int(match))
        except ValueError:
            continue

        digit_count = sum(1 for char in match if char.isdigit())
        candidates.append((numeric_value, digit_count))

    if not candidates:
        return None

    if previous_value is not None:
        candidates.sort(key=lambda entry: (abs(entry[0] - previous_value), -entry[1], -entry[0]))
    else:
        candidates.sort(key=lambda entry: (-entry[1], -entry[0]))

    return candidates[0][0]


def is_plausible_value(value: float, previous_value: Optional[float], integer_only: bool = False) -> bool:
    if integer_only:
        if value < 0:
            return False
        if value > 999_999_999:
            return False
        if previous_value is not None and abs(value - previous_value) > max(500_000, previous_value * 5):
            return False
    return True


def extract_number(
    image: Image.Image,
    previous_value: Optional[float],
    numeric_only: bool = False,
    integer_only: bool = False,
) -> tuple[Optional[float], str]:
    best_text = ""
    source_image = focus_crystals_region(image) if integer_only and numeric_only else image

    for variant in build_ocr_variants(source_image):
        for use_det in (True, False):
            try:
                result, _ = ocr(variant, use_det=use_det, use_cls=False, use_rec=True)
            except Exception:
                continue

            raw_text = extract_text(result)
            normalized_text = normalize_numeric_text(raw_text)
            candidate_text = apply_numeric_only_mode(normalized_text) if numeric_only else normalized_text
            if candidate_text and len(candidate_text) > len(best_text):
                best_text = candidate_text

            matches = INTEGER_PATTERN.findall(candidate_text) if integer_only else NUMBER_PATTERN.findall(candidate_text)
            if not matches:
                continue

            selected_value = (
                pick_best_integer_candidate(matches, previous_value)
                if integer_only
                else pick_best_candidate(matches, previous_value)
            )
            if selected_value is not None and is_plausible_value(
                selected_value,
                previous_value,
                integer_only=integer_only,
            ):
                return selected_value, candidate_text

    return None, best_text


def read_commands() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            command_queue.put(json.loads(line))
        except json.JSONDecodeError as error:
            emit({"type": "error", "message": f"Invalid config payload: {error}"})


def update_config() -> None:
    while True:
        try:
            command = command_queue.get_nowait()
        except queue.Empty:
            break

        if command.get("type") != "config":
            continue

        with config_lock:
            config.trackers = command.get("trackers", {})
            config.poll_interval_ms = max(150, int(command.get("pollIntervalMs", 650)))
            config.scanner_enabled = bool(command.get("scannerEnabled", True))


def capture_loop() -> None:
    last_values: dict[str, Optional[float]] = {}
    last_no_match_log: dict[str, tuple[str, float]] = {}
    last_state = None
    emit({"type": "status", "state": "starting"})

    with mss.mss() as sct:
        while True:
            update_config()
            with config_lock:
                trackers = config.trackers
                poll_interval_ms = config.poll_interval_ms
                scanner_enabled = config.scanner_enabled

            if not scanner_enabled:
                if last_state != "paused":
                    emit({"type": "status", "state": "paused"})
                    last_state = "paused"
                time.sleep(0.5)
                continue

            active_trackers = {
                tracker_key: tracker
                for tracker_key, tracker in trackers.items()
                if tracker and tracker.get("region")
            }

            if not active_trackers:
                if last_state != "waiting-for-region":
                    emit({"type": "status", "state": "waiting-for-region"})
                    last_state = "waiting-for-region"
                time.sleep(1.0)
                continue

            try:
                for tracker_key, tracker in active_trackers.items():
                    region = tracker["region"]
                    monitor = pad_region(region)

                    screenshot = sct.grab(monitor)
                    image = Image.frombytes("RGB", screenshot.size, screenshot.rgb)
                    tracker_label = tracker.get("label", tracker_key)
                    previous_value = last_values.get(tracker_key)
                    current_value, raw_text = extract_number(
                        image,
                        previous_value,
                        numeric_only=tracker_key == "crystals",
                        integer_only=True,
                    )

                    if current_value is not None:
                        delta = 0 if previous_value is None else current_value - previous_value
                        last_state = "reading"
                        emit(
                            {
                                "type": "reading",
                                "trackerKey": tracker_key,
                                "trackerLabel": tracker_label,
                                "currentValue": current_value,
                                "delta": delta,
                                "rawText": raw_text,
                            }
                        )
                        last_values[tracker_key] = current_value
                    else:
                        fallback_text = raw_text or "<empty>"
                        previous_no_match = last_no_match_log.get(tracker_key)
                        now = time.time()

                        if (
                            previous_no_match is None
                            or previous_no_match[0] != fallback_text
                            or now - previous_no_match[1] >= 5
                        ):
                            emit(
                                {
                                    "type": "log",
                                    "message": f"{tracker_label}: No number found. OCR saw: {fallback_text}",
                                }
                            )
                            last_no_match_log[tracker_key] = (fallback_text, now)
            except Exception as error:
                last_state = "error"
                emit({"type": "error", "message": str(error)})

            time.sleep(poll_interval_ms / 1000.0)


if __name__ == "__main__":
    reader = threading.Thread(target=read_commands, daemon=True)
    reader.start()
    capture_loop()
