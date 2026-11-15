
from __future__ import annotations

from dataclasses import dataclass
import pandas as pd


@dataclass
class SchemaResult:
    valid: bool
    source: str | None
    profile: str
    missing_columns: list[str]
    available_columns: list[str]
    errors: list[str]


class SchemaValidator:

    COMMON_COLUMNS = {
        "latitude", "longitude", "scan", "track",
        "acq_date", "acq_time", "satellite", "instrument",
        "confidence", "version", "frp", "daynight",
    }

    SCHEMA_PROFILES = {
        "sample_csv": {
            "MODIS": {"brightness", "bright_t31"},
            "VIIRS": {"brightness", "bright_t31"},
        },
        "firms_api": {
            "MODIS": {"brightness", "bright_t31"},
            "VIIRS": {"bright_ti4", "bright_ti5"},
        },
    }

    SATELLITE_INSTRUMENTS = {
        "AQUA": "MODIS",
        "TERRA": "MODIS",
        "N20": "VIIRS",
        "N21": "VIIRS",
    }

    @staticmethod
    def normalize_columns(dataframe: pd.DataFrame) -> pd.DataFrame:
        result = dataframe.copy()
        result.columns = (
            result.columns.astype(str)
            .str.strip()
            .str.lower()
            .str.replace(" ", "_", regex=False)
        )
        return result

    def validate(
        self,
        dataframe: pd.DataFrame,
        profile: str,
    ) -> SchemaResult:

        errors = []
        missing = []

        if profile not in self.SCHEMA_PROFILES:
            raise ValueError(
                f"Unknown schema profile: {profile}. "
                f"Expected one of: {list(self.SCHEMA_PROFILES)}"
            )

        working = self.normalize_columns(dataframe)
        columns = set(working.columns)

        if working.columns.duplicated().any():
            errors.append(
                "Duplicate column names after normalization."
            )

        if working.empty:
            errors.append("The input dataframe is empty.")

        source = None

        if "instrument" not in columns:
            errors.append("Missing instrument column.")
        else:
            instruments = (
                working["instrument"]
                .astype("string")
                .str.strip()
                .str.upper()
                .dropna()
                .unique()
            )

            if len(instruments) != 1:
                errors.append(
                    "Expected exactly one instrument per batch."
                )
            else:
                source = instruments[0]

                if source not in self.SCHEMA_PROFILES[profile]:
                    errors.append(
                        f"Unsupported instrument for {profile}: "
                        f"{source}"
                    )

        required = set(self.COMMON_COLUMNS)

        if source in self.SCHEMA_PROFILES[profile]:
            required |= self.SCHEMA_PROFILES[profile][source]

        missing = sorted(required - columns)

        if missing:
            errors.append(
                "Missing required columns: " + ", ".join(missing)
            )

        if "satellite" in columns and source:
            satellites = (
                working["satellite"]
                .astype("string")
                .str.strip()
                .str.upper()
                .dropna()
                .unique()
            )

            invalid = [
                satellite for satellite in satellites
                if self.SATELLITE_INSTRUMENTS.get(satellite) != source
            ]

            if invalid:
                errors.append(
                    f"Satellite/instrument mismatch: {invalid}"
                )

        return SchemaResult(
            valid=not errors,
            source=source,
            profile=profile,
            missing_columns=missing,
            available_columns=sorted(columns),
            errors=errors,
        )

    def validate_or_raise(
        self,
        dataframe: pd.DataFrame,
        profile: str,
    ) -> SchemaResult:

        result = self.validate(dataframe, profile)

        if not result.valid:
            raise ValueError(
                "Schema validation failed:\n- "
                + "\n- ".join(result.errors)
            )

        return result
