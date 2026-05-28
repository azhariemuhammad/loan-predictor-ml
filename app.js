// Dynamically resolve API_BASE to support Render (same origin) and local environments
const API_BASE = (window.location.protocol === 'file:' || !window.location.hostname)
    ? 'http://localhost:5002'
    : (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? (window.location.port === '5002' ? '' : 'http://localhost:5002')
        : '';

// ═══════════════════════════════════════════════════════════════════
//  SCORING ENGINE — Converts real-world inputs to 0-4 scores
//  based on the internal credit scorecard
// ═══════════════════════════════════════════════════════════════════

const SCORING_RULES = {
    // A. Borrower's Profile
    input_company_lob: {
        featureKey: 'company_length_of_business_months__lob',
        weight: 0.06,
        score(months) {
            if (months > 60) return 4;
            if (months >= 49) return 3;
            if (months >= 37) return 2;
            if (months >= 24) return 1;
            return 0;
        },
        label: 'Company LOB'
    },
    input_management_exp: {
        featureKey: 'management_experience_months__key_person',
        weight: 0.06,
        score(months) {
            if (months > 60) return 4;
            if (months >= 49) return 3;
            if (months >= 37) return 2;
            if (months >= 24) return 1;
            return 0;
        },
        label: 'Mgmt Experience'
    },
    input_pefindo_b6: {
        featureKey: 'pefindo_borrower_6_months_ever_dpd',
        weight: 0.05,
        score: null, // Direct select value
        label: 'Pefindo B. 6mo DPD'
    },
    input_pefindo_b12: {
        featureKey: 'pefindo_borrower_12_months_recurring_dpd',
        weight: 0.05,
        score: null,
        label: 'Pefindo B. 12mo DPD'
    },
    input_pefindo_m6: {
        featureKey: 'pefindo_management__6_months_ever_dpd__exclude_cc_and_consumer_loan_up_to_50_mio_overdue',
        weight: 0.04,
        score: null,
        label: 'Pefindo M. 6mo DPD'
    },
    input_pefindo_m12: {
        featureKey: 'pefindo_management__12_months_recurring_dpd__exclude_cc_and_consumer_loan_up_to_50_mio_overdue',
        weight: 0.04,
        score: null,
        label: 'Pefindo M. 12mo DPD'
    },

    // B. Borrower's Financial
    input_revenue_size: {
        featureKey: 'revenue_size',
        weight: 0.02,
        score(billions) {
            if (billions > 8) return 4;
            if (billions > 6) return 3;
            if (billions > 4) return 2;
            if (billions > 2) return 1;
            return 0;
        },
        label: 'Revenue Size'
    },
    input_past_due_recv: {
        featureKey: 'past_due_receivables__30_days',
        weight: 0.03,
        score(pct) {
            if (pct <= 1) return 4;
            if (pct <= 2) return 3;
            if (pct <= 3) return 2;
            if (pct <= 5) return 1;
            return 0;
        },
        label: 'Past Due Recv.'
    },
    input_ebitda_margin: {
        featureKey: 'ebitda_margin',
        weight: 0.03,
        score(pct) {
            if (pct > 20) return 4;
            if (pct > 16) return 3;  // >16-20%
            if (pct > 10) return 2;  // >10-15%
            if (pct > 0) return 1;   // >0-10%
            return 0;                 // 0% or Loss
        },
        label: 'EBITDA Margin'
    },
    input_yoy_growth: {
        featureKey: 'yoy_revenue_growth',
        weight: 0.02,
        score(pct) {
            if (pct > 20) return 4;
            if (pct > 15) return 3;
            if (pct > 10) return 2;
            if (pct > 5) return 1;
            return 0;
        },
        label: 'YoY Growth'
    },
    input_debt_to_ebitda: {
        featureKey: 'total_debt_to_ebitda',
        weight: 0.02,
        score(x) {
            if (x <= 0.5) return 4;
            if (x <= 1) return 3;
            if (x <= 2) return 2;
            if (x <= 3) return 1;
            return 0;
        },
        label: 'Debt/EBITDA'
    },
    input_dscr: {
        featureKey: 'existing_dscr',
        weight: 0.03,
        score(x) {
            if (x > 1.6) return 4;
            if (x > 1.4) return 3;
            if (x > 1.2) return 2;
            if (x > 1.0) return 1;
            return 0;
        },
        label: 'Existing DSCR'
    },
    input_avg_credit_sales: {
        featureKey: 'average_credit_bank_statement__sales',
        weight: 0.03,
        score(pct) {
            if (pct >= 80 && pct <= 150) return 4;
            if (pct >= 71 && pct < 80) return 3;
            if (pct >= 66 && pct < 71) return 2;
            if (pct >= 61 && pct < 66) return 1;
            return 0;  // ≤60% or >150%
        },
        label: 'Avg Credit/Sales'
    },
    input_trade_cycle: {
        featureKey: 'trade_cycle',
        weight: 0.02,
        score(days) {
            if (days <= 90) return 4;
            if (days <= 120) return 3;
            if (days <= 150) return 2;
            if (days <= 180) return 1;
            return 0;
        },
        label: 'Trade Cycle'
    },

    // C. Payor's Profile
    input_type_of_payor: {
        featureKey: 'type_of_payor',
        weight: 0.18,
        score: null,
        label: 'Type of Payor'
    },
    input_type_of_payment: {
        featureKey: 'type_of_payment',
        weight: 0.12,
        score: null,
        label: 'Type of Payment'
    },

    // D. Borrower Relationship
    input_repeat_order: {
        featureKey: 'repeat_order_with_proof_on_bs_or_legit_contract',
        weight: 0.20,
        score(times) {
            if (times >= 10) return 4;
            if (times >= 8) return 3;
            if (times >= 7) return 2;
            if (times >= 5) return 1;
            return 0;
        },
        label: 'Repeat Order'
    }
};

/**
 * Convert all form inputs to scored features for the model.
 * Returns { features: { featureKey: score }, scores: [{ label, score, weight }] }
 */
function convertToScores() {
    const features = {};
    const scores = [];

    for (const [inputId, rule] of Object.entries(SCORING_RULES)) {
        const el = document.getElementById(inputId);
        const rawValue = parseFloat(el.value);

        if (isNaN(rawValue)) {
            return null; // form validation will handle this
        }

        // If the rule has a score function, use it. Otherwise the select value IS the score.
        const score = rule.score ? rule.score(rawValue) : rawValue;

        features[rule.featureKey] = score;
        scores.push({ label: rule.label, score, weight: rule.weight });
    }

    return { features, scores };
}


// ═══════════════════════════════════════════════════════════════════
//  DOM Elements
// ═══════════════════════════════════════════════════════════════════

const form = document.getElementById('prediction-form');
const predictBtn = document.getElementById('predict-btn');
const btnLoader = predictBtn.querySelector('.loader');
const btnText = predictBtn.querySelector('.btn-text');
const resultContainer = document.getElementById('result-container');
const scoreValue = document.getElementById('probability-value');
const progressFill = document.getElementById('probability-fill');
const statusBadge = document.getElementById('status-badge');
const predictionLabel = document.getElementById('prediction-label');
const randomSampleBtn = document.getElementById('random-sample-btn');
const scoreSummary = document.getElementById('score-summary');
const scoreGrid = document.getElementById('score-grid');
const totalWeightedScore = document.getElementById('total-weighted-score');
const toggleScorecardBtn = document.getElementById('toggle-scorecard-btn');
const scoreGrade = document.getElementById('score-grade');

let scorecardVisible = false;

/**
 * Maps percentage score to Grade based on scorecard rules
 */
function calculateGrade(score) {
    if (score > 95) return { label: 'A1', class: 'grade-a' };
    if (score > 90) return { label: 'A2', class: 'grade-a' };
    if (score > 85) return { label: 'A3', class: 'grade-a' };
    if (score > 80) return { label: 'B1', class: 'grade-b' };
    if (score > 75) return { label: 'B2', class: 'grade-b' };
    if (score > 70) return { label: 'B3', class: 'grade-b' };
    if (score > 65) return { label: 'C1', class: 'grade-c' };
    if (score > 60) return { label: 'C2', class: 'grade-c' };
    if (score > 55) return { label: 'C3', class: 'grade-c' };
    if (score > 50) return { label: 'D1', class: 'grade-d' };
    if (score > 45) return { label: 'D2', class: 'grade-d' };
    if (score > 40) return { label: 'D3', class: 'grade-d' };
    return { label: 'E', class: 'grade-e' };
}

// ═══════════════════════════════════════════════════════════════════
//  Score Preview — Updates live as user fills the form
// ═══════════════════════════════════════════════════════════════════

function updateScorePreview() {
    const result = convertToScores();
    if (!result) {
        scoreSummary.classList.add('hidden');
        toggleScorecardBtn.disabled = true;
        return;
    }

    toggleScorecardBtn.disabled = false;
    const { scores } = result;
    let totalWeighted = 0;
    let maxWeighted = 0;

    scoreGrid.innerHTML = '';
    scores.forEach(({ label, score, weight }) => {
        totalWeighted += score * weight;
        maxWeighted += 4 * weight;

        const item = document.createElement('div');
        item.className = 'score-item';

        const scoreClass = score >= 3 ? 'score-good' : score >= 2 ? 'score-mid' : 'score-bad';

        item.innerHTML = `
            <span class="score-item-label">${label}</span>
            <span class="score-item-value ${scoreClass}">${score}/4</span>
        `;
        scoreGrid.appendChild(item);
    });

    const pct = ((totalWeighted / maxWeighted) * 100).toFixed(0);
    totalWeightedScore.textContent = pct;

    const grade = calculateGrade(parseFloat(pct));
    scoreGrade.textContent = grade.label;
    scoreGrade.className = `score-grade ${grade.class}`;

    if (scorecardVisible) {
        scoreSummary.classList.remove('hidden');
    }
}

// UI Initialization
toggleScorecardBtn.disabled = true;

// Toggle Scorecard
toggleScorecardBtn.addEventListener('click', () => {
    scorecardVisible = !scorecardVisible;
    scoreSummary.classList.toggle('hidden');
    toggleScorecardBtn.textContent = scorecardVisible ? 'Hide Scorecard Preview' : 'Show Scorecard Preview';
});
// ═══════════════════════════════════════════════════════════════════
//  UI Helpers
// ═══════════════════════════════════════════════════════════════════

function setLoading(loading) {
    if (loading) {
        predictBtn.disabled = true;
        btnLoader.classList.remove('hidden');
        btnText.style.opacity = '0.5';
    } else {
        predictBtn.disabled = false;
        btnLoader.classList.add('hidden');
        btnText.style.opacity = '1';
    }
}

function displayResult(data) {
    const emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.classList.add('hidden');
    
    resultContainer.classList.remove('hidden');

    // Animate probability
    const probPercent = (data.probability * 100).toFixed(1);
    scoreValue.innerText = `${probPercent}%`;
    progressFill.style.width = `${probPercent}%`;

    // Set Status Badge
    if (data.prediction === 0) {
        statusBadge.className = 'status-badge status-low';
        predictionLabel.innerText = 'Low Risk';
    } else {
        statusBadge.className = 'status-badge status-high';
        predictionLabel.innerText = 'High Risk';
    }

    // Handle Explanations
    const expSection = document.getElementById('explanation-section');
    const expList = document.getElementById('explanation-list');

    if (data.explanations && data.explanations.length > 0) {
        expList.innerHTML = '';
        data.explanations.forEach(item => {
            const div = document.createElement('div');
            div.className = 'explanation-item';

            const isNegative = item.value < 0;
            const impactClass = isNegative ? 'impact-low' : 'impact-high';
            const impactText = isNegative ? 'Decreases Risk' : 'Increases Risk';

            div.innerHTML = `
                <span class="feat-name">${item.feature.replaceAll('_', ' ').replaceAll(/\b\w/g, c => c.toUpperCase())}</span>
                <span class="feat-impact ${impactClass}">${impactText}</span>
            `;
            expList.appendChild(div);
        });
        expSection.classList.remove('hidden');
    } else {
        expSection.classList.add('hidden');
    }

    // Scroll to result
    resultContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}


// ═══════════════════════════════════════════════════════════════════
//  Form Submission — Convert to scores, then POST to /predict
// ═══════════════════════════════════════════════════════════════════

form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const result = convertToScores();
    if (!result) {
        alert('Please fill in all fields.');
        return;
    }

    // Update scorecard after Analyze Risk is clicked
    updateScorePreview();

    setLoading(true);
    resultContainer.classList.add('hidden');

    try {
        const response = await fetch(`${API_BASE}/predict`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ features: result.features }),
        });

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        displayResult(data);
        switchToResultTab();
    } catch (error) {
        console.error('Inference Error:', error);
        alert(`Error: ${error.message || 'Failed to connect to local API. Is server.py running?'}`);
    } finally {
        setLoading(false);
    }
});


// ═══════════════════════════════════════════════════════════════════
//  Random Sample Generator — produces realistic values
// ═══════════════════════════════════════════════════════════════════

function fillRandomSample() {
    const random = (min, max, decimals = 0) => {
        const val = Math.random() * (max - min) + min;
        return decimals === 0 ? Math.floor(val) : parseFloat(val.toFixed(decimals));
    };

    const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

    // Decide if we want a "healthy" or "risky" profile
    const isHealthy = Math.random() > 0.4;

    const samples = isHealthy ? {
        // Healthy profile — real-world values
        input_company_lob: random(40, 120),
        input_management_exp: random(48, 120),
        input_pefindo_b6: pickRandom(['4', '3']),
        input_pefindo_b12: pickRandom(['4', '3']),
        input_pefindo_m6: pickRandom(['4', '3']),
        input_pefindo_m12: pickRandom(['4', '3']),
        input_revenue_size: random(5, 15, 1),
        input_past_due_recv: random(0, 2, 1),
        input_ebitda_margin: random(15, 30, 1),
        input_yoy_growth: random(12, 35, 1),
        input_debt_to_ebitda: random(0.2, 1.5, 1),
        input_dscr: random(1.3, 2.5, 2),
        input_avg_credit_sales: random(75, 140, 1),
        input_trade_cycle: random(30, 120),
        input_type_of_payor: pickRandom(['4', '3']),
        input_type_of_payment: pickRandom(['4', '3']),
        input_repeat_order: random(7, 15),
    } : {
        // Risky profile — real-world values
        input_company_lob: random(12, 36),
        input_management_exp: random(12, 36),
        input_pefindo_b6: pickRandom(['1', '0']),
        input_pefindo_b12: pickRandom(['1', '0']),
        input_pefindo_m6: pickRandom(['1', '0']),
        input_pefindo_m12: pickRandom(['1', '0']),
        input_revenue_size: random(0.5, 3, 1),
        input_past_due_recv: random(3, 10, 1),
        input_ebitda_margin: random(-5, 10, 1),
        input_yoy_growth: random(-10, 8, 1),
        input_debt_to_ebitda: random(2, 5, 1),
        input_dscr: random(0.5, 1.1, 2),
        input_avg_credit_sales: random(30, 60, 1),
        input_trade_cycle: random(150, 250),
        input_type_of_payor: pickRandom(['1', '0']),
        input_type_of_payment: pickRandom(['1', '0']),
        input_repeat_order: random(3, 6),
    };

    Object.entries(samples).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) {
            el.value = value;
        }
    });

    // Pulse effect on inputs
    const inputs = form.querySelectorAll('input, select');
    inputs.forEach(input => {
        input.style.backgroundColor = 'rgba(37, 99, 235, 0.1)';
        setTimeout(() => {
            input.style.backgroundColor = '';
        }, 500);
    });
}

randomSampleBtn.addEventListener('click', fillRandomSample);


// ═══════════════════════════════════════════════════════════════════
//  Mobile Tab Switching
// ═══════════════════════════════════════════════════════════════════

const mobileTabContainer = document.getElementById('mobile-tabs');
const appContainer = document.querySelector('.layout-two-columns');

if (mobileTabContainer && appContainer) {
    const tabs = mobileTabContainer.querySelectorAll('.mobile-tab');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Update active tab button
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Set data attribute for CSS-based show/hide
            const activeTab = tab.dataset.tab;
            if (activeTab === 'result') {
                appContainer.setAttribute('data-active-tab', 'result');
            } else {
                appContainer.removeAttribute('data-active-tab');
            }
        });
    });
}

/**
 * Auto-switch to the Result tab after a successful prediction.
 */
function switchToResultTab() {
    const resultTab = document.getElementById('tab-result');
    if (resultTab) {
        resultTab.click();
    }
}
