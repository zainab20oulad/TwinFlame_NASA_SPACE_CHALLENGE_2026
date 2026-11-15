<div align="center">

# TwinFlame

### Harmonizing global MODIS and VIIRS active-fire detections

**NASA Space Apps Challenge 2026** · *Harmonization of MODIS and VIIRS Hot Spots*

[![Live Dashboard](https://img.shields.io/badge/Live%20Dashboard-Open-6C4AB6?style=for-the-badge)](https://twin-flame-nasa-space-challenge-202.vercel.app/)

*A clearer way to compare satellite observations, understand fire activity, and inspect the evidence behind every correspondence.*

</div>

---

## Table of contents

- [Overview](#-overview)
- [Why TwinFlame](#-why-twinflame)
- [What it does](#-what-it-does)
- [Data sources and satellite platforms](#-data-sources-and-satellite-platforms)
- [How the pipeline works](#-how-the-pipeline-works)
- [Harmonization methodology](#-harmonization-methodology)
- [Understanding the results](#-understanding-the-results)
- [Dashboard](#-dashboard)
- [Technology stack](#-technology-stack)
- [Data integrity and testing](#-data-integrity-and-testing)
- [Benefits and future direction](#-benefits-and-future-direction)
- [Running the pipeline](#-running-the-pipeline)

---

## Overview

Wildfires reach far beyond the flames. They destroy homes and ecosystems, endanger lives, send smoke across regions, and carry significant economic costs. In a changing climate, hotter and drier fire-weather conditions are becoming more frequent in many parts of the world. They are among several factors—alongside vegetation, land use, and ignition sources—that shape fire behaviour.

Satellites provide a global view of fire activity, but combining their observations is not straightforward. Different instruments have different spatial resolutions, viewing geometries, and overpass times. A hotspot detected by one instrument and a nearby hotspot detected by another may describe the same fire activity—or they may not.

**TwinFlame** is a global satellite fire-detection harmonization and analysis platform. It brings observations from multiple satellite platforms into a consistent analytical workflow while preserving their original sensor information and making cross-sensor comparisons explainable.

## Why TwinFlame

Comparing satellite detections using coordinates alone can lead to misleading conclusions. MODIS and VIIRS do not observe fires in exactly the same way, so a reliable comparison needs to consider more than whether two points are close together.

TwinFlame addresses this challenge by combining:

- **Sensor-aware standardization** while retaining native measurements and sensor identity.
- **Geometry-aware comparison** using observation footprints, not only point coordinates.
- **Temporal analysis** to assess whether observations occurred close enough in time.
- **Explainable correspondence classes** so users can inspect why a candidate pair received its classification.
- **Spatio-temporal clustering** to explore related observations as broader activity patterns.

The central question is not simply *“Are these hotspots close?”* It is:

> **Do observations from different instruments plausibly represent the same fire activity?**

## What it does

TwinFlame provides an end-to-end workflow that:

1. Acquires active-fire observations from NASA FIRMS APIs and historical archive products.
2. Validates incoming records and standardizes them into a common structure.
3. Preserves each observation's original platform, sensor identity, and native measurements.
4. Evaluates candidate correspondences between MODIS and VIIRS detections.
5. Organizes related observations into broader spatio-temporal activity clusters.
6. Presents the observations, comparisons, and processing evidence in an interactive dashboard.

## Data sources and satellite platforms

The current source set covers four satellite platforms:

| Platform | Instrument | Approximate spatial resolution |
|---|---|---:|
| Terra | MODIS | 1 km |
| Aqua | MODIS | 1 km |
| NOAA-20 | VIIRS | 375 m |
| NOAA-21 | VIIRS | 375 m |

Data are obtained from **NASA Fire Information for Resource Management System (FIRMS)** APIs and historical FIRMS archive files. The historical archive provides context for studying real observation patterns and assessing harmonization parameters and thresholds.

**Suomi-NPP is not included in the current source set.** NOAA announced that delivery of new Suomi-NPP science data, including VIIRS, would end on 2 November 2026. Its historical observations remain archived, while NOAA-20 and NOAA-21 continue the VIIRS record.

## How the pipeline works

| Stage | What happens |
|---|---|
| **1. Acquire** | Collect observations from NASA FIRMS APIs and historical archives. |
| **2. Standardize** | Validate records and map them into a common structure while retaining native values. |
| **3. Harmonize** | Evaluate spatial footprints, temporal proximity, and geometry quality. |
| **4. Cluster** | Organize related detections into spatio-temporal activity clusters. |
| **5. Explore** | Inspect observations, results, and evidence through the dashboard. |

TwinFlame uses a geometry-aware methodology. It considers differences in MODIS and VIIRS resolution and observation footprints, evaluates spatial and temporal correspondence together, and accounts for viewing geometry. Each candidate correspondence receives an explainable classification. Related observations can then be grouped into activity clusters, with the supporting evidence available for inspection.

## Harmonization methodology

This is the central technical contribution of TwinFlame. MODIS and VIIRS differ in spatial resolution, viewing geometry, and acquisition time. Comparing detection coordinates alone can therefore produce misleading correspondences.

TwinFlame evaluates multiple types of evidence for each candidate pair.

### 1. Footprint overlap — Intersection over Union (IoU)

The overlap between two observation footprints is measured using Intersection over Union:

\[
IoU(A,B)=\frac{|A\cap B|}{|A\cup B|}
\]

Where:

- \(A\) and \(B\) are the two observation footprints.
- The intersection is their shared area.
- The union is the total area covered by both footprints.

A higher IoU indicates stronger spatial overlap. **An IoU ≥ 0.20 indicates a strong correspondence.**

### 2. Spatial distance — Haversine formula

The separation between the two detection centroids is calculated as a great-circle distance:

\[
a=\sin^2\left(\frac{\Delta\phi}{2}\right)
+\cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta\lambda}{2}\right)
\]

\[
d=2R\arcsin(\sqrt{a})
\]

Here, \(\phi_1\) and \(\phi_2\) are the latitudes in radians, \(\Delta\phi\) and \(\Delta\lambda\) are the latitude and longitude differences, and \(R\) is Earth's mean radius (approximately 6,371,000 m).

A **3 km proximity threshold** defines a possible correspondence.

### 3. Temporal correspondence

The acquisition times of the two observations are compared:

\[
\Delta t=|t_A-t_B|
\]

The temporal decision limit is **120 minutes**. Candidate observations must be plausible in both space and time.

### 4. Geometry quality

A satellite's viewing angle affects the footprint it observes, with distortion increasing toward the edge of the swath.

Cases with a **scan angle greater than 55°** are flagged as having insufficient geometry for a reliable correspondence decision.

### 5. Correspondence classification

Each candidate pair receives one of four explainable classes:

| Class | Interpretation |
|---|---|
| **Strong** | Supported by sufficient footprint overlap (IoU ≥ 0.20). |
| **Possible** | Spatially and temporally plausible, but without the same level of geometric evidence. This is not a confirmed match. |
| **Rejected** | Fails the spatial or temporal criteria. |
| **Insufficient Geometry** | The footprint geometry is not reliable enough for a confident decision. |

### 6. Activity clustering

After correspondence analysis, related observations are organized into spatio-temporal activity clusters using **DBSCAN**:

| Parameter | Value |
|---|---:|
| Spatial epsilon | 2.5 km |
| Temporal epsilon | 6 hours |
| MinPts | 1 |

Clustering turns individual detections into broader fire-activity patterns that are easier to follow over time.

## Understanding the results

Results should be interpreted with the characteristics and limitations of the instruments in mind:

- A satellite detection is an **observation**, not necessarily a unique fire event.
- MODIS and VIIRS confidence values use different scales and are not directly interchangeable.
- FRP differences are interpreted in the context of each instrument; they are not automatic evidence against a correspondence.
- Footprints used for overlap are screening envelopes built from each detection's scan and track dimensions, not exact pixel outlines.
- A **Possible** correspondence is not a confirmed match.
- TwinFlame does not predict fires or issue verified emergency warnings.

## Dashboard

The dashboard is an analytical interface—not simply a fire map. It allows users to move from a global overview to the evidence behind an individual candidate correspondence.

**[Open the TwinFlame dashboard](https://twin-flame-nasa-space-challenge-202.vercel.app/)**

| Dashboard section | What it offers |
|---|---|
| **Overview & Live Monitoring** | Filter observations by date, satellite, region, day/night, and FRP. Monitor incoming observations and distinguish satellite acquisition time from data retrieval time. |
| **Geospatial Exploration** | Explore individual detections, activity-cluster extents and member observations, and spatial density patterns. |
| **Fire Season Monitor** | Compare activity across years and months and explore seasonal patterns using platform, day/night, and other filters. |
| **Historical Fire Analysis** | Examine long-term detection trends, FRP evolution, cluster counts and sizes, historical spatial distributions, and continent comparisons; export data. |
| **Sensor Comparison** | Compare Terra, Aqua, NOAA-20, and NOAA-21 through detection counts and shares, FRP and brightness-temperature distributions, daily trends, diurnal patterns, and coincident-hotspot matching. Resolution differences must be considered when interpreting count differences. |
| **Harmonization Evaluation** | Inspect correspondence classes, distance and time-difference distributions, IoU and containment, quality by satellite pair, and cluster composition. |
| **Candidate Edge Inspector** | Compare two candidate detections side by side, inspect their attributes and spatial/temporal metrics, view their locations and correspondence line on a map, read the decision rationale, and export evidence to CSV or JSON. |
| **Quality & Methodology** | Review data completeness, missing or invalid values, duplicates, quality by platform, source metadata, checksums, processing records, equations, thresholds, and assumptions. |
| **Pipeline Management** | Review ingestion, standardization, and harmonization runs—including status, duration, record counts, source files, checksums, and versions—and dispatch controlled runs with configuration options and a dry-run setting. |
| **Alerts Center** | Shows illustrative sample alerts to demonstrate the interface. These are not verified live alerts, and TwinFlame does not send emergency notifications. |

### Why the Candidate Edge Inspector matters

The Candidate Edge Inspector makes each correspondence open to verification. Instead of asking users to trust a match, it shows the two observations, their metrics, their map locations, and the rationale behind the assigned class.

## Technology stack

| Area | Technologies |
|---|---|
| Programming languages | Python, SQL, JavaScript / TypeScript |
| Data processing | Pandas, NumPy |
| Data format | Parquet |
| Analytical database | DuckDB |
| Data acquisition | NASA FIRMS APIs and historical archive products |
| Backend | FastAPI |
| Frontend | React, Vite |
| Geospatial visualization | Leaflet |
| Mathematical rendering | KaTeX |
| Version control and collaboration | Git, GitHub |
| Environment and deployment | Docker |
| Development hardware | Standard Windows-based development computers |

## Data integrity and testing

TwinFlame includes engineering measures designed to protect data integrity and keep processing results traceable:

- **SHA-256 checksums** verify source-file integrity.
- **Input validation** checks records before they enter the system.
- **Processing and ingestion records** connect results to their source data.
- **Read-only dashboard data access** helps protect the underlying analytical data.
- **Server-side mutex locking** coordinates pipeline execution.
- **Controlled background tasks** manage pipeline jobs.

Testing has been carried out across data validation, processing, integrity, and application workflows. These safeguards do **not** constitute a formal security certification or an independent penetration test.

## Benefits and future direction

TwinFlame aims to contribute to more coherent and interpretable satellite-based fire analysis:

- **More coherent monitoring:** observations from four satellite platforms can be compared and explored in one workflow.
- **More careful correspondence analysis:** footprint overlap, timing, and geometry quality help reduce misleading matches based only on coordinate proximity.
- **Stronger research capabilities:** historical trends, seasonal patterns, and sensor comparisons support the investigation of fire activity.
- **A foundation for future research:** the harmonized historical dataset could later be combined with weather, vegetation, land-cover, and other environmental variables to support fire-risk modelling.

### Objectives

TwinFlame aims to:

1. Provide a reusable global workflow for harmonizing multi-satellite active-fire observations.
2. Improve the consistency and interpretability of cross-sensor observations.
3. Support research into fire behaviour and long-term fire patterns.
4. Establish a stronger data foundation for future fire-risk analysis and predictive research.

**Important scope note:** Future predictive research is a potential direction, not a current TwinFlame capability. TwinFlame is an analysis platform; it does not currently predict fires or issue emergency warnings.

## ▶ Running the pipeline

Want to run the TwinFlame pipeline locally?

**Follow the step-by-step instructions in [`doc/run.md`](doc/run.md).**

That document is the guide for setting up the environment and running the pipeline. Refer to it before launching a pipeline run.

---

<div align="center">

**TwinFlame** · NASA Space Apps Challenge 2026

*Turning satellite detections into evidence you can explore.*

</div>
