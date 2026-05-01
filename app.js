// API Configuration - Uses relative paths as frontend is served by the backend
const API_BASE = ''; 



// DOM Elements
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

// UI Helpers
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

    // Scroll to result
    resultContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Form Submission
form.addEventListener('submit', async (e) => {
    e.preventDefault();

    setLoading(true);
    resultContainer.classList.add('hidden');

    const formData = new FormData(form);
    const rawFeatures = {};
    formData.forEach((value, key) => {
        rawFeatures[key] = parseFloat(value);
    });

    const features = {};
    formData.forEach((value, key) => {
        features[key] = parseFloat(value);
    });

    try {
        const response = await fetch(`${API_BASE}/predict`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ features }),
        });

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        displayResult(data);
    } catch (error) {
        console.error('Inference Error:', error);
        alert(`Error: ${error.message || 'Failed to connect to local API. Is server.py running?'}`);
    } finally {
        setLoading(false);
    }
});

// Random Sample Generator
function fillRandomSample() {
    const random = (min, max, decimals = 0) => {
        const val = Math.random() * (max - min) + min;
        return decimals === 0 ? Math.floor(val) : parseFloat(val.toFixed(decimals));
    };

    // Decide if we want to generate a 'Healthy' or 'Risky' profile
    const isRisky = Math.random() > 0.5;
    const getVal = () => isRisky ? random(3, 5) : random(1, 3);

    const sampleData = {
        average_credit_bank_statement__sales: getVal(),
        company_length_of_business_months__lob: getVal(),
        ebitda_margin: getVal(),
        existing_dscr: getVal(),
        management_experience_months__key_person: getVal(),
        past_due_receivables__30_days: getVal(),
        pefindo_borrower_12_months_recurring_dpd: getVal(),
        pefindo_borrower_6_months_ever_dpd: getVal(),
        pefindo_management__12_months_recurring_dpd__exclude_cc_and_consumer_loan_up_to_50_mio_overdue: getVal(),
        pefindo_management__6_months_ever_dpd__exclude_cc_and_consumer_loan_up_to_50_mio_overdue: getVal(),
        repeat_order_with_proof_on_bs_or_legit_contract: getVal(),
        revenue_size: getVal(),
        total_debt_to_ebitda: getVal(),
        trade_cycle: getVal(),
        type_of_payment: getVal(),
        type_of_payor: getVal(),
        yoy_revenue_growth: getVal()
    };

    Object.keys(sampleData).forEach(key => {
        const input = document.getElementById(key);
        if (input) {
            input.value = sampleData[key];
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
