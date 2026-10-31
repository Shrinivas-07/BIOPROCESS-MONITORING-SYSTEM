# 🧪 IoT-Based Bioprocess Monitoring & Growth Prediction System
### AICTE IDEA Lab 1st Semester Student Group Project

An interdisciplinary biotechnology and IoT system that continuously monitors culture vessel parameters (Turbidity, Temperature, pH, and Headspace Gas/CO₂) via an **ESP32**, logs time-series data to **Supabase Cloud (PostgreSQL)**, and uses **Python mathematical modeling** to classify microbial growth phases and recommend optimal harvest timing.

---

## 📁 Project Architecture & Directory Structure

```text
IDEA-LAB 1st SEM STUDENT PROJECT/
├── backend/
│   ├── app.py                      # Flask Server (Dual page serving, Batch APIs, Ingestion)
│   ├── config.py                   # Environment & Supabase config (Batches + Readings tables)
│   ├── requirements.txt            # Python dependencies
│   └── services/
│       ├── growth_engine.py        # Python Growth Model (Logistic curve fitting, dN/dt derivative)
│       ├── simulator.py            # Biological batch fermentation simulator (Lag, Log, Stationary, Death)
│       └── supabase_service.py     # Multi-batch lifecycle manager & PostgREST client
├── frontend/
│   ├── index.html                  # High-End Professional Landing Page (Scrollytelling, Scrubber, Parallax)
│   ├── research.html               # Live Research Studio (Reaction modal, Stop button, History Replay)
│   ├── css/
│   │   ├── landing.css             # Landing page animations, horizontal scroll rail, culture vessel
│   │   └── style.css               # Studio theme, glows, phase badges, glassmorphism
│   └── js/
│       ├── api.js                  # Frontend API client (Batch lifecycle & Telemetry)
│       ├── charts.js               # Growth curve, derivative dN/dt, and 3-axis Env/Gas charts
│       ├── app.js                  # Studio controller (New batch modal, Stop reaction, History replay)
│       └── landing.js              # Interactive culture scrubber sandbox & scrollytelling
├── cloud/
│   └── supabase_schema.sql         # Relational schema (bioprocess_batches + bioprocess_readings)
├── firmware/
│   └── esp32_supabase_sample.ino   # Reference ESP32 C++ sketch for Wi-Fi & HTTPS POST
├── run.py                          # One-click local launcher
├── .env.example                    # Template for Supabase credentials
└── README.md                       # Complete documentation
```

---

## 🚀 Quick Start (Running Locally)

### 1. Launch the Web Application
Open your terminal in the project directory and run:

```bash
python run.py
```
This boots the server at **`http://localhost:5000`** and automatically opens your default browser.

> **Note:** If you haven't connected Supabase yet, the system automatically starts in **Simulation Mode** with a full batch history, allowing you to demonstrate the dashboard and growth prediction algorithms immediately!

---

## ⚡ Connecting to Supabase Cloud

1. Log in to [Supabase](https://supabase.com) and create a new project.
2. Open the **SQL Editor** in your Supabase dashboard.
3. Open [`cloud/supabase_schema.sql`](cloud/supabase_schema.sql), copy its contents, paste them into the SQL editor, and click **RUN**.
4. In Supabase, go to **Project Settings** → **API**:
   - Copy your **Project URL** (e.g. `https://xyzcompany.supabase.co`)
   - Copy your **anon / public key**
5. Either:
   - Paste them into your `.env` file:
     ```env
     SUPABASE_URL=https://your-project-id.supabase.co
     SUPABASE_KEY=your-supabase-anon-key
     SUPABASE_TABLE=bioprocess_readings
     ```
   - **OR** click the **"⚙️ Supabase Config"** button directly in the top right corner of the dashboard web interface and click **Save & Connect**.

---

## 🧠 How Python Detects Growth Phases & Harvest Windows

### Mathematical Modeling
Microbial growth is evaluated using the **Logistic Growth Equation** and numerical differentiation:

$$N(t) = N_0 + \frac{K - N_0}{1 + e^{-r(t - t_0)}}$$

- $N(t)$: Optical Density / Turbidity at time $t$
- $K$: Maximum carrying capacity (plateau)
- $r$: Intrinsic growth rate coefficient
- $t_0$: Sigmoid midpoint (inflection point of maximum growth rate)

### Classification Logic

| Growth Phase | Biological Meaning | Mathematical Detection Criterion | Action Recommendation |
| :--- | :--- | :--- | :--- |
| **Lag Phase** | Cells adapt to nutrient broth; enzyme synthesis. | $\Delta Turbidity < 45\text{ NTU}$ from baseline; $OD/OD_0 < 1.25$ | *"Microbes adjusting to broth nutrients. Continue incubation at 30-37°C."* |
| **Log (Exponential)** | Rapid cell division; maximum rate $\mu_{\max}$. | $\frac{dN}{dt} > 5\text{ NTU/hr}$, steep upward slope. | *"Rapid cellular division active (+12%/hr). Continue incubation; monitor pH drop. Prepare harvest equipment."* |
| **Stationary Phase** | Nutrients deplete; population hits peak biomass. | Prior significant growth ($>100\text{ NTU}$ increase) AND rate flattens ($\frac{dN}{dt} \le 3.5\text{ NTU/hr}$ or $\Delta \le 2\text{ NTU}$). | **"⚠️ Optimal harvest window reached! Culture has achieved peak biomass. COLLECT SAMPLE NOW for maximum yield."** |
| **Death Phase** | Cells lyse; toxic metabolite accumulation. | $N(t) \le N_{\max} - 25\text{ NTU}$ with negative slope. | *"Viability declining due to toxic metabolite accumulation. Harvest immediately or terminate batch."* |

---

## 📡 ESP32 Hardware & Sensor Integration

### Pinout Connections
- **Turbidity Sensor (SEN0189 / Photodiode module):** Signal $\rightarrow$ **GPIO 34** (ADC1)
- **pH Probe (E-201-C / 4502C module):** Signal $\rightarrow$ **GPIO 35** (ADC1)
- **Headspace Gas Sensor (MQ-135 / CO₂ / VOC):** Signal $\rightarrow$ **GPIO 32** (ADC1)
- **Temperature (DS18B20 Waterproof Probe):** Data $\rightarrow$ **GPIO 4** (with 4.7kΩ pull-up resistor to 3.3V)
- **Power:** 5V / 3.3V and GND from ESP32 board

### Data Packet Format
The ESP32 posts JSON packets directly to Supabase via HTTPS REST:

```json
{
  "turbidity": 792.0,
  "temperature": 30.3,
  "ph": 5.90,
  "gas": 2920.0,
  "device_id": "ESP32_LAB_01"
}
```

---

## 🌐 Deploying to the Cloud (Production)

The project is structured for 1-click deployment on platforms like **Render**, **Railway**, or **Vercel**:

### Deploying on Render (Free Web Service)
1. Push this project to a GitHub repository.
2. In Render, select **New +** → **Web Service**.
3. Connect your repository.
4. Set:
   - **Environment:** `Python 3`
   - **Build Command:** `pip install -r backend/requirements.txt`
   - **Start Command:** `python run.py` (or `gunicorn backend.app:app`)
5. In **Environment Variables**, add:
   - `SUPABASE_URL`
   - `SUPABASE_KEY`
   - `SUPABASE_TABLE`
6. Click **Deploy Web Service**!
