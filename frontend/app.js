const eventPayload = document.querySelector('#eventPayload');
const message = document.querySelector('#message');
const sendButton = document.querySelector('#sendButton');
const formatButton = document.querySelector('#formatButton');
const refreshButton = document.querySelector('#refreshButton');
const resultsTable = document.querySelector('#resultsTable');
const emptyResults = document.querySelector('#emptyResults');
const responseOutput = document.querySelector('#responseOutput');
const lastRunStatus = document.querySelector('#lastRunStatus');
const scenarioButtons = document.querySelectorAll('.scenario-button');
const eventLookupInput = document.querySelector('#eventLookupInput');
const inspectEventButton = document.querySelector('#inspectEventButton');
const inspectFirstButton = document.querySelector('#inspectFirstButton');
const eventSummary = document.querySelector('#eventSummary');
const eventDeliveriesTable = document.querySelector('#eventDeliveriesTable');
const emptyEventDeliveries = document.querySelector('#emptyEventDeliveries');
const eventHistoryTable = document.querySelector('#eventHistoryTable');
const emptyEventHistory = document.querySelector('#emptyEventHistory');
const eventDecisionsTable = document.querySelector('#eventDecisionsTable');
const emptyEventDecisions = document.querySelector('#emptyEventDecisions');
const eventInspectorOutput = document.querySelector('#eventInspectorOutput');

let activeScenario = null;
let payloadEditedManually = false;
let lastQueuedResults = [];

const metricFields = [
  'rawDeliveriesCount',
  'queuedJobsCount',
  'pendingEventsCount',
  'processedEventsCount',
  'rejectedEventsCount',
  'duplicateEventsCount',
];

const scenarioFactories = {
  stress: (runId) => {
    const orderId = `ord-stress-${runId}`;

    return [
      {
        eventId: `evt-stress-${runId}-002`,
        orderId,
        type: 'PAYMENT_CAPTURED',
        timestamp: 1710002000,
        payload: { amount: 120 },
      },
      {
        eventId: `evt-stress-${runId}-001`,
        orderId,
        type: 'ORDER_CREATED',
        timestamp: 1710001000,
        payload: { amount: 120, currency: 'PLN' },
      },
      {
        eventId: `evt-stress-${runId}-003`,
        orderId,
        type: 'ORDER_UPDATED',
        timestamp: 1710003000,
        payload: { amount: 130 },
      },
      {
        eventId: `evt-stress-${runId}-004`,
        orderId,
        type: 'ORDER_UPDATED',
        timestamp: 1710002500,
        payload: { amount: 125, currency: 'EUR' },
      },
      {
        eventId: `evt-stress-${runId}-005`,
        orderId,
        type: 'REFUND_ISSUED',
        timestamp: 1710004000,
        payload: { refundAmount: 30 },
      },
      {
        eventId: `evt-stress-${runId}-003`,
        orderId,
        type: 'ORDER_UPDATED',
        timestamp: 1710003000,
        payload: { amount: 130 },
      },
    ];
  },
  ordering: (runId) => {
    const orderId = `ord-chaos-${runId}`;

    return [
      {
        eventId: `evt-ordering-${runId}-003`,
        orderId,
        type: 'REFUND_ISSUED',
        timestamp: 1710003000,
        payload: { refundAmount: 30 },
      },
      {
        eventId: `evt-ordering-${runId}-002`,
        orderId,
        type: 'PAYMENT_CAPTURED',
        timestamp: 1710002000,
        payload: { amount: 120 },
      },
      {
        eventId: `evt-ordering-${runId}-001`,
        orderId,
        type: 'ORDER_CREATED',
        timestamp: 1710001000,
        payload: { amount: 120, currency: 'PLN' },
      },
    ];
  },
  malformed: (runId) => [
    {
      eventId: '',
      orderId: `ord-malformed-${runId}`,
      type: 'ORDER_CREATED',
      timestamp: 1710001000,
      payload: { amount: 50, currency: 'PLN' },
    },
    {
      eventId: `evt-malformed-${runId}-unknown`,
      orderId: `ord-malformed-${runId}`,
      type: 'ALIEN_SIGNAL',
      timestamp: 1710001100,
      payload: {},
    },
    {
      eventId: `evt-malformed-${runId}-timestamp`,
      orderId: `ord-malformed-${runId}`,
      type: 'ORDER_UPDATED',
      timestamp: 'not-a-number',
      payload: { amount: 40 },
    },
    {
      eventId: `evt-malformed-${runId}-payload`,
      orderId: `ord-malformed-${runId}`,
      type: 'ORDER_UPDATED',
      timestamp: 1710001200,
      payload: null,
    },
    {
      eventId: `evt-malformed-${runId}-money`,
      orderId: `ord-malformed-${runId}`,
      type: 'REFUND_ISSUED',
      timestamp: 1710001300,
      payload: { refundAmount: -30 },
    },
    'not even an object',
    null,
  ],
  transitions: (runId) => {
    const orderId = `ord-state-${runId}`;

    return [
      {
        eventId: `evt-state-${runId}-001`,
        orderId,
        type: 'ORDER_CREATED',
        timestamp: 1710004000,
        payload: { amount: 80, currency: 'PLN' },
      },
      {
        eventId: `evt-state-${runId}-002`,
        orderId,
        type: 'ORDER_CANCELLED',
        timestamp: 1710004100,
        payload: {},
      },
      {
        eventId: `evt-state-${runId}-003`,
        orderId,
        type: 'PAYMENT_CAPTURED',
        timestamp: 1710004200,
        payload: { amount: 80 },
      },
      {
        eventId: `evt-state-${runId}-004`,
        orderId,
        type: 'REFUND_ISSUED',
        timestamp: 1710004300,
        payload: { refundAmount: 80 },
      },
    ];
  },
  duplicate: (runId) => {
    const orderId = `ord-dupe-${runId}`;
    const eventId = `evt-dupe-${runId}-001`;

    return [
      {
        eventId,
        orderId,
        type: 'ORDER_CREATED',
        timestamp: 1710001000,
        payload: { amount: 70, currency: 'PLN' },
      },
      {
        eventId,
        orderId,
        type: 'ORDER_CREATED',
        timestamp: 1710001000,
        payload: { amount: 70, currency: 'PLN' },
      },
    ];
  },
  partial: (runId) => {
    const orderId = `ord-partial-${runId}`;

    return [
      {
        eventId: `evt-partial-${runId}-001`,
        orderId,
        type: 'ORDER_CREATED',
        timestamp: 1710001000,
        payload: { amount: 100, currency: 'PLN' },
      },
      {
        eventId: `evt-partial-${runId}-003`,
        orderId,
        type: 'ORDER_UPDATED',
        timestamp: 1710003000,
        payload: { amount: 150 },
      },
      {
        eventId: `evt-partial-${runId}-002`,
        orderId,
        type: 'ORDER_UPDATED',
        timestamp: 1710002000,
        payload: { amount: 120, currency: 'EUR' },
      },
    ];
  },
  refund: (runId) => {
    const orderId = `ord-refund-${runId}`;

    return [
      {
        eventId: `evt-refund-${runId}-001`,
        orderId,
        type: 'ORDER_CREATED',
        timestamp: 1710001000,
        payload: { amount: 120, currency: 'PLN' },
      },
      {
        eventId: `evt-refund-${runId}-002`,
        orderId,
        type: 'PAYMENT_CAPTURED',
        timestamp: 1710002000,
        payload: { amount: 120 },
      },
      {
        eventId: `evt-refund-${runId}-003`,
        orderId,
        type: 'REFUND_ISSUED',
        timestamp: 1710003000,
        payload: { refundAmount: 40 },
      },
      {
        eventId: `evt-refund-${runId}-004`,
        orderId,
        type: 'REFUND_ISSUED',
        timestamp: 1710004000,
        payload: { refundAmount: 80 },
      },
    ];
  },
  guards: (runId) => {
    const orderId = `ord-guards-${runId}`;

    return [
      {
        eventId: `evt-guards-${runId}-001`,
        orderId,
        type: 'ORDER_CREATED',
        timestamp: 1710001000,
        payload: { amount: 50, currency: 'PLN' },
      },
      {
        eventId: `evt-guards-${runId}-002`,
        orderId,
        type: 'PAYMENT_CAPTURED',
        timestamp: 1710002000,
        payload: { amount: 50 },
      },
      {
        eventId: `evt-guards-${runId}-003`,
        orderId,
        type: 'PAYMENT_CAPTURED',
        timestamp: 1710003000,
        payload: { amount: 50 },
      },
      {
        eventId: `evt-guards-${runId}-004`,
        orderId,
        type: 'REFUND_ISSUED',
        timestamp: 1710004000,
        payload: { refundAmount: 60 },
      },
    ];
  },
  invalid: () => ({
    eventId: 'evt-not-a-batch',
    orderId: 'ord-invalid',
    type: 'ORDER_CREATED',
    timestamp: 1710000000,
    payload: { amount: 10 },
  }),
};

function createRunId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function setMessage(text, type = '') {
  message.textContent = text;
  message.className = `message ${type}`.trim();
}

function setBusy(isBusy) {
  sendButton.disabled = isBusy;
  formatButton.disabled = isBusy;
  refreshButton.disabled = isBusy;
  inspectEventButton.disabled = isBusy;
  inspectFirstButton.disabled = isBusy;
}

function setScenario(name) {
  activeScenario = name;
  payloadEditedManually = false;
  refreshScenarioPayload();

  for (const button of scenarioButtons) {
    button.classList.toggle('active', button.dataset.scenario === name);
  }

  setMessage('');
}

function refreshScenarioPayload() {
  if (!activeScenario) {
    return;
  }

  eventPayload.value = JSON.stringify(
    scenarioFactories[activeScenario](createRunId()),
    null,
    2,
  );
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = Array.isArray(body.message)
      ? body.message.join(', ')
      : body.message;
    throw new Error(detail || `Request failed with ${response.status}`);
  }

  return body;
}

async function sendBatch() {
  setBusy(true);
  setMessage('');
  lastRunStatus.textContent = 'Sending';

  try {
    const beforeStats = await loadStats();

    if (activeScenario && !payloadEditedManually) {
      refreshScenarioPayload();
    }

    const parsed = JSON.parse(eventPayload.value);
    const response = await requestJson('/api/events', {
      method: 'POST',
      body: JSON.stringify(parsed),
    });

    lastQueuedResults = response.results || [];
    renderResults(response.results || []);
    renderResponse(response);

    const settledStats = await waitForProcessedCount(
      beforeStats.processedEventsCount + response.summary.queued,
    );
    const processedDelta =
      settledStats.processedEventsCount - beforeStats.processedEventsCount;

    setMessage(
      `Queued ${response.summary.queued} deliveries. Worker processed ${processedDelta}.`,
      'success',
    );
    lastRunStatus.textContent =
      processedDelta >= response.summary.queued ? 'Processed' : 'Queued';

    await inspectFirstQueuedEvent();
  } catch (error) {
    lastQueuedResults = [];
    renderResults([]);
    renderResponse({ error: error.message });
    setMessage(error.message, 'error');
    lastRunStatus.textContent = 'Failed';
  } finally {
    setBusy(false);
  }
}

async function loadStats() {
  const stats = await requestJson('/api/stats');

  for (const field of metricFields) {
    document.querySelector(`#${field}`).textContent = String(stats[field] ?? 0);
  }

  return stats;
}

async function waitForProcessedCount(targetProcessedCount) {
  let stats = await loadStats();

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (
      stats.processedEventsCount >= targetProcessedCount ||
      stats.pendingEventsCount === 0
    ) {
      return stats;
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
    stats = await loadStats();
  }

  return stats;
}

function formatPayload() {
  try {
    eventPayload.value = JSON.stringify(
      JSON.parse(eventPayload.value),
      null,
      2,
    );
    setMessage('JSON formatted.', 'success');
  } catch (error) {
    setMessage(error.message, 'error');
  }
}

function renderResults(results) {
  resultsTable.innerHTML = '';
  emptyResults.hidden = results.length > 0;

  for (const result of results) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td><span class="badge queued">QUEUED</span></td>
    `;

    const cells = row.querySelectorAll('td');
    cells[0].textContent = String(result.incomingEventId);
    cells[1].textContent = String(result.processingJobId);
    if (result.eventId) {
      const eventButton = document.createElement('button');
      eventButton.className = 'link-button';
      eventButton.type = 'button';
      eventButton.textContent = result.eventId;
      eventButton.addEventListener('click', () => {
        eventLookupInput.value = result.eventId;
        void inspectEvent(result.eventId);
      });
      cells[2].append(eventButton);
    } else {
      cells[2].textContent = '-';
    }
    cells[3].textContent = result.orderId || '-';
    cells[4].textContent = result.type || '-';

    resultsTable.append(row);
  }
}

function renderResponse(value) {
  responseOutput.textContent = JSON.stringify(value, null, 2);
}

async function inspectFirstQueuedEvent() {
  const first = lastQueuedResults.find((result) => result.eventId);

  if (!first) {
    renderEventInspector(null);
    return;
  }

  eventLookupInput.value = first.eventId;
  await inspectEvent(first.eventId);
}

async function inspectEvent(eventId = eventLookupInput.value.trim()) {
  if (!eventId) {
    renderEventInspector(null);
    setMessage('Provide an eventId to inspect.', 'error');
    return;
  }

  try {
    const details = await requestJson(
      `/api/events/${encodeURIComponent(eventId)}`,
    );
    renderEventInspector(details);
  } catch (error) {
    renderEventInspector({ error: error.message, eventId });
    setMessage(error.message, 'error');
  }
}

function renderEventInspector(details) {
  eventDeliveriesTable.innerHTML = '';
  eventHistoryTable.innerHTML = '';
  eventDecisionsTable.innerHTML = '';
  eventInspectorOutput.textContent = JSON.stringify(details || {}, null, 2);

  if (!details || details.error) {
    eventSummary.innerHTML = '<span>No event loaded.</span>';
    emptyEventDeliveries.hidden = false;
    emptyEventHistory.hidden = false;
    emptyEventDecisions.hidden = false;
    return;
  }

  const latestDecision =
    details.decisions.length > 0
      ? details.decisions[details.decisions.length - 1]
      : null;
  eventSummary.innerHTML = '';
  eventSummary.append(
    summaryItem('Event', details.eventId),
    summaryItem('Orders', details.orderIds.join(', ') || '-'),
    summaryItem('Deliveries', String(details.deliveries.length)),
    summaryItem('Decisions', String(details.decisions.length)),
    summaryItem('History rows', String(details.history.length)),
    summaryItem(
      'Latest',
      latestDecision
        ? `${latestDecision.decision} / ${latestDecision.reasonCode}`
        : '-',
    ),
  );

  renderEventDeliveries(details.deliveries);
  renderEventHistory(details.history);
  renderEventDecisions(details.decisions);
}

function renderEventDeliveries(deliveries) {
  emptyEventDeliveries.hidden = deliveries.length > 0;

  for (const delivery of deliveries) {
    const row = document.createElement('tr');
    const latest = delivery.processingJob?.latestDecision;
    appendCells(row, [
      String(delivery.rawIncomingEventId),
      delivery.processingJob ? String(delivery.processingJob.id) : '-',
      delivery.processingJob?.status || '-',
      latest?.decision || '-',
      latest?.reasonCode || '-',
    ]);
    eventDeliveriesTable.append(row);
  }
}

function renderEventHistory(history) {
  emptyEventHistory.hidden = history.length > 0;

  for (const entry of history) {
    const row = document.createElement('tr');
    appendCells(row, [
      entry.orderId,
      entry.type,
      entry.fromStatus || '-',
      entry.toStatus,
      JSON.stringify(entry.changedFields),
    ]);
    eventHistoryTable.append(row);
  }
}

function renderEventDecisions(decisions) {
  emptyEventDecisions.hidden = decisions.length > 0;

  for (const decision of decisions) {
    const row = document.createElement('tr');
    appendCells(row, [
      String(decision.id),
      decision.decision,
      decision.reasonCode,
      decision.reasonMessage,
    ]);
    eventDecisionsTable.append(row);
  }
}

function appendCells(row, values) {
  for (const value of values) {
    const cell = document.createElement('td');
    cell.textContent = value;
    row.append(cell);
  }
}

function summaryItem(label, value) {
  const item = document.createElement('div');
  const labelElement = document.createElement('span');
  const valueElement = document.createElement('strong');

  labelElement.textContent = label;
  valueElement.textContent = value;
  item.append(labelElement, valueElement);

  return item;
}

scenarioButtons.forEach((button) => {
  button.addEventListener('click', () => setScenario(button.dataset.scenario));
});

eventPayload.addEventListener('input', () => {
  activeScenario = null;
  payloadEditedManually = true;

  for (const button of scenarioButtons) {
    button.classList.remove('active');
  }
});

sendButton.addEventListener('click', () => void sendBatch());
inspectEventButton.addEventListener('click', () => void inspectEvent());
inspectFirstButton.addEventListener(
  'click',
  () => void inspectFirstQueuedEvent(),
);
formatButton.addEventListener('click', formatPayload);
refreshButton.addEventListener('click', () => void loadStats());

setScenario('stress');
renderEventInspector(null);
void loadStats();
