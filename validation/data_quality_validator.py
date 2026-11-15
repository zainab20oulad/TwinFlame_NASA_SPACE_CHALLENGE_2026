
from __future__ import annotations

import numpy as np
import pandas as pd


class DataQualityValidator:

    NUMERIC_COLUMNS = {
        "latitude", "longitude", "scan", "track", "frp",
    }

    BRIGHTNESS_COLUMNS = {
        "brightness", "bright_t31", "bright_ti4", "bright_ti5",
    }

    REQUIRED_COLUMNS = {
        "latitude", "longitude", "acq_date", "acq_time",
        "satellite", "instrument", "confidence", "version",
        "scan", "track", "frp", "daynight",
    }

    VIIRS_CONFIDENCE = {"l", "n", "h"}

    VALID_SATELLITES = {
        "AQUA": "MODIS",
        "TERRA": "MODIS",
        "N20": "VIIRS",
        "N21": "VIIRS",
    }

    @staticmethod
    def _valid_time(value):
        if pd.isna(value):
            return False

        text = str(value).strip()

        if text.endswith(".0"):
            text = text[:-2]

        if not text.isdigit() or len(text) > 4:
            return False

        text = text.zfill(4)

        hour = int(text[:2])
        minute = int(text[2:])

        return 0 <= hour <= 23 and 0 <= minute <= 59

    def validate(self, dataframe: pd.DataFrame) -> dict:

        working = dataframe.copy().reset_index(drop=True)

        missing = self.REQUIRED_COLUMNS - set(working.columns)

        if missing:
            raise ValueError(
                f"Quality validation missing required columns: "
                f"{sorted(missing)}"
            )

        reasons = pd.Series(
            [[] for _ in range(len(working))],
            index=working.index,
            dtype=object,
        )

        def reject(mask, message):
            mask = pd.Series(
                mask, index=working.index
            ).fillna(True).astype(bool)

            for index in working.index[mask]:
                reasons.at[index].append(message)

        for column in self.REQUIRED_COLUMNS:
            reject(
                working[column].isna(),
                f"Missing value: {column}",
            )

        numeric_columns = (
            self.NUMERIC_COLUMNS | self.BRIGHTNESS_COLUMNS
        )

        for column in numeric_columns:
            if column not in working.columns:
                continue

            numeric = pd.to_numeric(
                working[column],
                errors="coerce",
            )

            working[column] = numeric

            reject(
                numeric.isna() | ~np.isfinite(numeric),
                f"Invalid numeric value: {column}",
            )

        latitude = working["latitude"]
        longitude = working["longitude"]

        reject(
            ~latitude.between(-90, 90),
            "Latitude outside [-90, 90]",
        )

        reject(
            ~longitude.between(-180, 180),
            "Longitude outside [-180, 180]",
        )

        for column in ("scan", "track"):
            reject(
                working[column] <= 0,
                f"{column} must be positive",
            )

        reject(
            working["frp"] < 0,
            "FRP cannot be negative",
        )

        for column in self.BRIGHTNESS_COLUMNS:
            if column not in working.columns:
                continue

            reject(
                working[column] <= 0,
                f"{column} must be positive",
            )

        dates = pd.to_datetime(
            working["acq_date"],
            format="%Y-%m-%d",
            errors="coerce",
        )

        reject(dates.isna(), "Invalid acquisition date")

        reject(
            ~working["acq_time"].apply(self._valid_time),
            "Invalid acquisition time (expected UTC HHMM)",
        )

        satellite = (
            working["satellite"]
            .astype("string")
            .str.strip()
            .str.upper()
        )

        instrument = (
            working["instrument"]
            .astype("string")
            .str.strip()
            .str.upper()
        )

        expected_instrument = satellite.map(
            self.VALID_SATELLITES
        )

        reject(
            expected_instrument.isna()
            | (expected_instrument != instrument),
            "Invalid satellite/instrument combination",
        )

        confidence = (
            working["confidence"]
            .astype("string")
            .str.strip()
            .str.lower()
        )

        is_modis = instrument.eq("MODIS")
        is_viirs = instrument.eq("VIIRS")

        modis_confidence = pd.to_numeric(
            working["confidence"],
            errors="coerce",
        )

        reject(
            is_modis & (
                modis_confidence.isna()
                | ~modis_confidence.between(0, 100)
            ),
            "MODIS confidence must be between 0 and 100",
        )

        reject(
            is_viirs & ~confidence.isin(self.VIIRS_CONFIDENCE),
            "VIIRS confidence must be l, n or h",
        )

        daynight = (
            working["daynight"]
            .astype("string")
            .str.strip()
            .str.upper()
        )

        reject(
            ~daynight.isin({"D", "N"}),
            "Day/night must be D or N",
        )

        working["quality_reasons"] = reasons

        rejected_mask = reasons.apply(bool)

        rejected = working.loc[rejected_mask].copy()
        valid = working.loc[~rejected_mask].copy()

        return {
            "valid": valid.drop(columns=["quality_reasons"]),
            "rejected": rejected,
            "metrics": {
                "input_rows": len(working),
                "valid_rows": len(valid),
                "rejected_rows": len(rejected),
            },
        }
