const eventPayload = document.querySelector('#eventPayload');
const message = document.querySelector('#message');
const sendButton = document.querySelector('#sendButton');
const formatButton = document.querySelector('#formatButton');
const refreshButton = document.querySelector('#refreshButton');
const siteNav = document.querySelector('.site-nav');
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
const eventInspectorPanel = eventSummary.closest('.inspector-panel');
const orderLookupInput = document.querySelector('#orderLookupInput');
const inspectOrderButton = document.querySelector('#inspectOrderButton');
const inspectFirstOrderButton = document.querySelector(
  '#inspectFirstOrderButton',
);
const orderSummary = document.querySelector('#orderSummary');
const orderHistoryTable = document.querySelector('#orderHistoryTable');
const emptyOrderHistory = document.querySelector('#emptyOrderHistory');
const orderRejectedTable = document.querySelector('#orderRejectedTable');
const emptyOrderRejected = document.querySelector('#emptyOrderRejected');
const orderPendingTable = document.querySelector('#orderPendingTable');
const emptyOrderPending = document.querySelector('#emptyOrderPending');
const orderAuditTable = document.querySelector('#orderAuditTable');
const emptyOrderAudit = document.querySelector('#emptyOrderAudit');
const orderInspectorOutput = document.querySelector('#orderInspectorOutput');
const orderInspectorPanel = orderSummary.closest('.inspector-panel');

let activeScenario = null;
let payloadEditedManually = false;
let lastQueuedResults = [];

const metricFields = [
  'validEventsCount',
  'rejectedEventsCount',
  'duplicateEventsCount',
  'averageProcessingTimeMs',
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
  inspectOrderButton.disabled = isBusy;
  inspectFirstOrderButton.disabled = isBusy;
}

function updateNavState() {
  siteNav.classList.toggle('scrolled', window.scrollY > 8);
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
    const beforeFinalizedCount = finalizedEventsCount(await loadStats());

    if (activeScenario && !payloadEditedManually) {
      refreshScenarioPayload();
    }

    const parsed = JSON.parse(eventPayload.value);
    const response = await requestJson('/api/events', {
      method: 'POST',
      body: JSON.stringify(parsed),
    });
    const queuedBatch = normalizeQueuedBatch(response, parsed);

    lastQueuedResults = queuedBatch.results;
    renderResults(queuedBatch.results);
    renderResponse(response);

    const settledStats = await waitForFinalizedCount(
      beforeFinalizedCount + queuedBatch.queuedCount,
    );
    const processedDelta =
      finalizedEventsCount(settledStats) - beforeFinalizedCount;

    setMessage(
      `Queued ${queuedBatch.queuedCount} deliveries. Worker processed ${processedDelta}.`,
      'success',
    );
    lastRunStatus.textContent =
      processedDelta >= queuedBatch.queuedCount ? 'Processed' : 'Queued';

    await Promise.all([inspectFirstQueuedEvent(), inspectFirstQueuedOrder()]);
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

function normalizeQueuedBatch(response, submittedPayload) {
  if (response && Array.isArray(response.results)) {
    return {
      queuedCount: response.summary?.queued ?? response.results.length,
      results: response.results,
    };
  }

  const events = Array.isArray(response)
    ? response
    : Array.isArray(submittedPayload)
      ? submittedPayload
      : [];

  return {
    queuedCount: events.length,
    results: events.map((event) => {
      const projection = projectQueuedEvent(event);

      return {
        incomingEventId: null,
        processingJobId: null,
        eventId: projection.eventId,
        orderId: projection.orderId,
        type: projection.type,
      };
    }),
  };
}

function projectQueuedEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return {
      eventId: null,
      orderId: null,
      type: null,
    };
  }

  return {
    eventId: typeof event.eventId === 'string' ? event.eventId : null,
    orderId: typeof event.orderId === 'string' ? event.orderId : null,
    type: typeof event.type === 'string' ? event.type : null,
  };
}

async function loadStats() {
  const stats = await requestJson('/api/stats');

  for (const field of metricFields) {
    document.querySelector(`#${field}`).textContent = String(stats[field] ?? 0);
  }

  return stats;
}

function finalizedEventsCount(stats) {
  return (
    stats.validEventsCount +
    stats.rejectedEventsCount +
    stats.duplicateEventsCount
  );
}

async function waitForFinalizedCount(targetFinalizedCount) {
  let stats = await loadStats();

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (finalizedEventsCount(stats) >= targetFinalizedCount) {
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
    cells[0].textContent = displayValue(result.incomingEventId);
    cells[1].textContent = displayValue(result.processingJobId);
    renderInspectorLink(
      cells[2],
      result.eventId,
      eventLookupInput,
      inspectEvent,
      eventInspectorPanel,
    );
    renderInspectorLink(
      cells[3],
      result.orderId,
      orderLookupInput,
      inspectOrder,
      orderInspectorPanel,
    );
    cells[4].textContent = result.type || '-';

    resultsTable.append(row);
  }
}

function renderInspectorLink(cell, id, lookupInput, inspect, scrollTarget) {
  if (!id) {
    cell.textContent = '-';
    return;
  }

  const button = document.createElement('button');
  button.className = 'link-button';
  button.type = 'button';
  button.textContent = id;
  button.addEventListener('click', () => {
    lookupInput.value = id;
    void inspect(id);
    scrollTarget?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  cell.append(button);
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
  clearTableBodies(
    eventDeliveriesTable,
    eventHistoryTable,
    eventDecisionsTable,
  );
  eventInspectorOutput.textContent = JSON.stringify(details || {}, null, 2);

  if (!details || details.error) {
    eventSummary.innerHTML = '<span>No event loaded.</span>';
    showEmptyStates(
      emptyEventDeliveries,
      emptyEventHistory,
      emptyEventDecisions,
    );
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
  renderTableRows(
    eventDeliveriesTable,
    emptyEventDeliveries,
    deliveries,
    (delivery) => {
      const latest = delivery.processingJob?.latestDecision;
      return [
        String(delivery.rawIncomingEventId),
        delivery.processingJob ? String(delivery.processingJob.id) : '-',
        delivery.processingJob?.status || '-',
        latest?.decision || '-',
        latest?.reasonCode || '-',
      ];
    },
  );
}

function renderEventHistory(history) {
  renderTableRows(eventHistoryTable, emptyEventHistory, history, (entry) => [
    entry.orderId,
    entry.type,
    entry.fromStatus || '-',
    entry.toStatus,
    JSON.stringify(entry.changedFields),
  ]);
}

function renderEventDecisions(decisions) {
  renderTableRows(
    eventDecisionsTable,
    emptyEventDecisions,
    decisions,
    (decision) => [
      String(decision.id),
      decision.decision,
      decision.reasonCode,
      decision.reasonMessage,
    ],
  );
}

async function inspectFirstQueuedOrder() {
  const first = lastQueuedResults.find((result) => result.orderId);

  if (!first) {
    renderOrderInspector(null);
    return;
  }

  orderLookupInput.value = first.orderId;
  await inspectOrder(first.orderId);
}

async function inspectOrder(orderId = orderLookupInput.value.trim()) {
  if (!orderId) {
    renderOrderInspector(null);
    setMessage('Provide an orderId to inspect.', 'error');
    return;
  }

  try {
    const details = await requestJson(
      `/api/orders/${encodeURIComponent(orderId)}`,
    );
    renderOrderInspector(details);
  } catch (error) {
    renderOrderInspector({ error: error.message, orderId });
    setMessage(error.message, 'error');
  }
}

function renderOrderInspector(details) {
  clearTableBodies(
    orderHistoryTable,
    orderRejectedTable,
    orderPendingTable,
    orderAuditTable,
  );
  orderInspectorOutput.textContent = JSON.stringify(details || {}, null, 2);

  if (!details || details.error) {
    orderSummary.innerHTML = '<span>No order loaded.</span>';
    showEmptyStates(
      emptyOrderHistory,
      emptyOrderRejected,
      emptyOrderPending,
      emptyOrderAudit,
    );
    return;
  }

  const state = details.currentState;
  orderSummary.innerHTML = '';
  orderSummary.append(
    summaryItem('Order', details.orderId),
    summaryItem('Status', state ? state.status : 'No current state'),
    summaryItem('Amount minor', state ? displayValue(state.amountMinor) : '-'),
    summaryItem('Currency', state ? displayValue(state.currency) : '-'),
    summaryItem(
      'Paid minor',
      state ? displayValue(state.paidAmountMinor) : '-',
    ),
    summaryItem(
      'Refunded minor',
      state ? displayValue(state.refundedAmountMinor) : '-',
    ),
    summaryItem('Audit rows', String(details.auditLog.length)),
  );

  renderOrderHistory(details.history);
  renderOrderRejectedEvents(details.rejectedEvents);
  renderOrderPendingJobs(details.pendingJobs);
  renderOrderAuditLog(details.auditLog);
}

function renderOrderHistory(history) {
  renderTableRows(orderHistoryTable, emptyOrderHistory, history, (entry) => [
    entry.eventId,
    entry.type,
    entry.fromStatus || '-',
    entry.toStatus,
    JSON.stringify(entry.changedFields),
    JSON.stringify(entry.skippedFields),
  ]);
}

function renderOrderRejectedEvents(rejectedEvents) {
  renderTableRows(
    orderRejectedTable,
    emptyOrderRejected,
    rejectedEvents,
    (event) => [
      event.eventId || '-',
      event.type || '-',
      event.decision,
      event.reasonCode,
      event.reasonMessage,
    ],
  );
}

function renderOrderPendingJobs(pendingJobs) {
  renderTableRows(orderPendingTable, emptyOrderPending, pendingJobs, (job) => [
    String(job.id),
    job.eventId || '-',
    job.type || '-',
    job.status,
    String(job.attempts),
    job.lastReasonCode || '-',
  ]);
}

function renderOrderAuditLog(auditLog) {
  renderTableRows(orderAuditTable, emptyOrderAudit, auditLog, (decision) => [
    String(decision.id),
    decision.eventId || '-',
    decision.decision,
    decision.reasonCode,
    decision.reasonMessage,
  ]);
}

function displayValue(value) {
  return value === null || value === undefined ? '-' : String(value);
}

function clearTableBodies(...tables) {
  for (const table of tables) {
    table.innerHTML = '';
  }
}

function showEmptyStates(...emptyStates) {
  for (const emptyState of emptyStates) {
    emptyState.hidden = false;
  }
}

function renderTableRows(table, emptyState, entries, valuesForEntry) {
  emptyState.hidden = entries.length > 0;

  for (const entry of entries) {
    const row = document.createElement('tr');
    appendCells(row, valuesForEntry(entry));
    table.append(row);
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
inspectOrderButton.addEventListener('click', () => void inspectOrder());
inspectFirstOrderButton.addEventListener(
  'click',
  () => void inspectFirstQueuedOrder(),
);
formatButton.addEventListener('click', formatPayload);
refreshButton.addEventListener('click', () => void loadStats());
window.addEventListener('scroll', updateNavState, { passive: true });

updateNavState();
setScenario('stress');
renderEventInspector(null);
renderOrderInspector(null);
void loadStats();
