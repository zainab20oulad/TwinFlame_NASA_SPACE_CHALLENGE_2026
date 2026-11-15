# TwinFlame_NASA_SPACE_CHALLENGE_2026
Harmonization of MODIS and VIIRS Hot Spots

DASHOBARD_URL: https://twin-flame-nasa-space-challenge-202.vercel.app/
TwinFlame
Harmonizing global MODIS and VIIRS active-fire detections
Project description  •  NASA Space Apps Challenge 2026
1. Why we chose this challenge
Wildfires reach far beyond the flames. They destroy homes and ecosystems, endanger lives, send smoke across entire regions and carry heavy economic costs. In a changing climate, hotter and drier fire-weather conditions are becoming more frequent in many parts of the world. They are one of several factors, alongside vegetation, land use and ignition sources, that shape how fire behaves.
Satellites give us the only truly global view of fire, but reading that view is harder than it looks. Four platforms (Terra, Aqua, NOAA-20 and NOAA-21) carry two different instruments, MODIS and VIIRS, which differ in spatial resolution, viewing geometry and the time of day they pass overhead. A hotspot reported by one instrument and a hotspot reported by another may describe the same fire activity, or they may not. Reliable monitoring and long-term research depend on knowing which.
TwinFlame was built to help answer that question. It makes satellite fire observations more comparable, more coherent and easier to investigate.
2. What TwinFlame does
TwinFlame is a global satellite fire-detection harmonization and analysis platform. It:
•	Acquires active-fire observations from NASA FIRMS.
•	Standardizes them into a common structure while preserving each observation’s original sensor identity and native measurements.
•	Evaluates possible correspondences between MODIS and VIIRS detections.
•	Organizes related observations into broader spatio-temporal activity clusters.
•	Presents the results in an interactive analytical dashboard.

TwinFlame does not simply merge nearby coordinates. It asks a harder question: do observations from different instruments plausibly represent the same fire activity?
Satellites and data sources
The current source set covers four platforms: Terra and Aqua (MODIS, about 1 km resolution) and NOAA-20 and NOAA-21 (VIIRS, about 375 m resolution). Data come from the NASA FIRMS APIs and from historical NASA FIRMS archive files. The archive is an important part of the project: it provided historical context and let us study real observation patterns when selecting and assessing harmonization parameters and thresholds.
Suomi-NPP is not part of the current source set. NOAA announced that delivery of new Suomi-NPP science data, including VIIRS, would end on 2 November 2026 (NOAA NESDIS notice). Its historical observations remain archived, and NOAA-20 and NOAA-21 continue the VIIRS record.
3. How it works
1  Acquire
NASA FIRMS APIs and archive	2  Standardize
Common structure, native values kept	3  Harmonize
Footprint, time and geometry evidence	4  Cluster
Spatio-temporal activity	5  Explore
Interactive dashboard

TwinFlame collects and validates FIRMS observations and standardizes their structure while keeping their original sensor information intact. It then applies a geometry-aware harmonization methodology. Rather than comparing coordinates alone, it takes into account the different pixel resolutions and observation footprints of MODIS and VIIRS, and evaluates spatial and temporal correspondence together. Off-nadir viewing and geometry quality are factored in, and every candidate correspondence receives an explainable classification. Related observations can then be organized into activity clusters, and all of this evidence stays open to inspection in the dashboard.
4. Harmonization methodology
This is the central technical contribution of TwinFlame. MODIS and VIIRS do not observe fires in the same way: they differ in spatial resolution, viewing geometry and acquisition time. Comparing detection coordinates alone can therefore produce misleading correspondences. TwinFlame evaluates richer spatial and temporal evidence for each candidate pair.
4.1 Footprint overlap: Intersection over Union
The overlap between the footprints of two observations is measured with Intersection over Union (IoU):
IoU(A, B)  =  |A ∩ B|  /  |A ∪ B|
Here A and B are the two observation footprints, the intersection is their shared area and the union is the total area they cover together. A higher IoU means stronger spatial overlap. An IoU ≥ 0.20 indicates a strong correspondence.
4.2 Spatial distance
The separation between the two centroids is measured as a great-circle (Haversine) distance:
a  =  sin2(Δφ / 2)  +  cos φ1 • cos φ2 • sin2(Δλ / 2)
d  =  2R • arcsin( √(a) )
Here φ₁ and φ₂ are the latitudes in radians, Δφ and Δλ are the latitude and longitude differences, and R is Earth’s mean radius (about 6,371,000 m). A 3 km proximity threshold defines a possible correspondence.
4.3 Temporal correspondence
The acquisition times of the two satellites are compared:
Δt  =  |tA − tB|
The temporal decision limit is 120 minutes. Two observations are considered corresponding only if they are plausible both geographically and in time.
4.4 Geometry quality
A satellite’s viewing angle distorts the footprint it observes, and the distortion grows toward the edge of the swath. Cases with a scan angle beyond 55° are flagged as having insufficient geometry for a reliable correspondence decision.
4.5 Correspondence classification
Each candidate pair receives one of four explainable classes:
Class	Meaning
Strong	Supported by sufficient footprint overlap (IoU ≥ 0.20).
Possible	Spatially and temporally plausible, but without the same level of geometric evidence. Not a confirmed match.
Rejected	Fails the spatial or temporal criteria.
Insufficient Geometry	The footprint geometry is not reliable enough for a confident decision.

4.6 Activity clustering
After correspondence analysis, related observations are organized into spatio-temporal activity clusters with DBSCAN, using a spatial epsilon of 2.5 km, a temporal epsilon of 6 hours and MinPts = 1. Clusters turn individual detections into broader fire-activity patterns that are easier to follow over time.
Reading the results correctly
• A satellite detection is an observation, not necessarily a unique fire event.
• MODIS and VIIRS confidence values use different scales and are not directly interchangeable.
• FRP differences are interpreted in the context of the instruments and are not treated as automatic evidence against a correspondence.
• The footprints used for overlap are screening envelopes built from each detection’s scan and track dimensions, not exact pixel outlines.
• TwinFlame does not predict fires and does not issue verified emergency warnings.
5. What makes TwinFlame innovative and creative?
TwinFlame brings cross-sensor comparison, footprint geometry, temporal analysis, explainability and historical exploration together in a single workflow. Five elements make that combination distinctive:
1.	Geometry-aware harmonization. Instead of relying on nearby coordinates, TwinFlame evaluates actual footprint overlap through IoU, alongside centroid distance and timing.
2.	Instrument-aware comparison. The method accounts for the different spatial resolutions and viewing geometries of MODIS and VIIRS.
3.	Explainable decisions. Candidate pairs fall into meaningful classes, and users can inspect the evidence behind each decision instead of receiving unexplained matches.
4.	From detections to activity. Correspondence evaluation is followed by spatio-temporal clustering, so fire activity can be explored at a broader scale.
5.	Integrated and transparent. The methodology is connected to a dashboard that unites sensor comparison, historical analysis, quality auditing and direct inspection of candidate correspondences.
6. Factors our team considered
Building a trustworthy harmonization workflow meant weighing several scientific and practical factors:
•	Instrument differences. MODIS (about 1 km) and VIIRS (about 375 m) differ in resolution, viewing geometry and overpass time, so detection counts and positions cannot be compared naively.
•	Evidence beyond coordinates. Footprint overlap, time difference and geometry quality all matter, so correspondence is judged on several kinds of evidence together.
•	Preserving native information. Each observation keeps its sensor identity and native values. MODIS and VIIRS confidence scales differ, and FRP is read in the context of the instrument.
•	Careful interpretation. A detection is an observation, not necessarily a unique fire, and a possible correspondence is not a confirmed match. The results are labelled accordingly.
•	Choice of data. FIRMS APIs provide current observations, while historical archive files gave real patterns for assessing thresholds. Suomi-NPP was left out because NOAA ended delivery of its new data.
•	Transparency and integrity. Checksums, processing records and an inspectable decision rationale keep every result traceable and open to scrutiny.
•	Responsible scope. TwinFlame is a research and analysis tool. It does not predict fires or issue emergency warnings, and the Alerts Center is purely illustrative.
7. The TwinFlame dashboard
The dashboard is an analytical interface, not simply a fire map. It lets users move from a global overview down to the evidence behind a single candidate correspondence.
Page	What it offers
Overview and Live Monitoring	Filter observations by date, satellite, region, day/night and FRP; monitor incoming observations and distinguish satellite acquisition time from data retrieval time.
Geospatial Exploration	Explore individual detections, activity-cluster extents and member observations, and spatial density patterns.
Fire Season Monitor	Compare activity across years and months and explore seasonal patterns, filtered by platform, day/night and other criteria.
Historical Fire Analysis	Long-term detection trends, FRP evolution, cluster counts and sizes over time, historical spatial distributions and continent comparisons, with data export.
Sensor Comparison	Compare Terra, Aqua, NOAA-20 and NOAA-21 through detection counts and shares, FRP and brightness-temperature distributions, daily trends, diurnal patterns and coincident-hotspot matching. MODIS (about 1 km) and VIIRS (about 375 m) resolution differences must be considered when reading count differences.
Harmonization Evaluation	Strong, possible, rejected and insufficient-geometry correspondences; distance and time-difference distributions; IoU and containment; quality by satellite pair; cluster composition.
Candidate Edge Inspector	Place two candidate detections side by side, compare platforms, times, coordinates, FRP and other attributes, view spatial and temporal metrics, see both on a map joined by a correspondence line, read the decision rationale and export the evidence to CSV or JSON.
Quality & Methodology	Data-completeness indicators, missing or invalid values, duplicate records, quality by platform, source-file metadata, checksums and processing records, plus the equations, thresholds and assumptions.
Pipeline Management	Review ingestion, standardization and harmonization runs (successes, failures, durations, record counts, source files, checksums, versions) and dispatch controlled harmonization runs with configuration options and a dry-run setting.
Alerts Center	Presents illustrative sample alerts to show how such an interface could look. They are not verified live alerts, and TwinFlame does not send emergency notifications.

Why the Candidate Edge Inspector matters
It turns every correspondence into something a user can verify. Rather than trusting a match, users see the two observations, the metrics, the map and the rationale behind the class that was assigned.
8. Tools, languages, hardware and software
Area	Technologies
Programming languages	Python, SQL, JavaScript / TypeScript
Data processing	Pandas, NumPy
Data formats	Parquet
Analytical database	DuckDB
Data acquisition	NASA FIRMS APIs and historical archive products
Backend	FastAPI
Frontend	React, Vite
Geospatial visualization	Leaflet
Mathematical rendering	KaTeX
Version control and collaboration	Git, GitHub
Environment and deployment	Docker
Hardware	Standard Windows-based development computers

9. Security, integrity and testing
TwinFlame includes engineering measures that protect data integrity and keep every result traceable:
•	SHA-256 checksums verify the integrity of source files.
•	Input validation checks data before it enters the system.
•	Processing and ingestion records make each result traceable to its source.
•	Read-only data access for the dashboard.
•	A server-side mutex lock coordinates pipeline execution, and pipeline jobs run as controlled background tasks.

Testing has been carried out across the project’s data validation, processing, integrity and application workflows. These are engineering safeguards; they do not constitute a formal security certification or an independent penetration test.
10. Benefits and expected impact
•	More coherent fire monitoring. Observations from four satellites can be compared and explored together, instead of being treated as disconnected feeds.
•	More reliable correspondence analysis. Footprint overlap, timing and geometry quality help reduce misleading matches based only on coordinate proximity.
•	Better research capabilities. Historical trends, seasonal patterns and sensor comparisons help researchers investigate fire activity.
•	A foundation for future prediction research. The harmonized historical dataset could later be combined with weather, vegetation, land-cover and other environmental variables to support fire-risk modelling. This is future potential: TwinFlame is not currently a fire-prediction system.
11. Objectives and future ambitions
TwinFlame aims to:
•	Provide a reusable global workflow for harmonizing multi-satellite active-fire observations.
•	Improve the consistency and interpretability of cross-sensor observations.
•	Support research into fire behaviour and long-term fire patterns.
•	Establish a stronger data foundation for future fire-risk analysis and predictive research.
