(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const questions = window.EXAM_QUESTIONS;
  const endpoint = String(window.EXAM_ENDPOINT || '').trim();
  const validEndpoint = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec\/?$/.test(endpoint);
  let order = [];
  let index = 0;
  let responses = {};
  let identity = null;
  let attempt = null;
  let startedAt = null;
  let hiddenCount = 0;
  let active = false;
  let sending = false;

  function shuffle(items) {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  function newToken() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }
  function show(screen) {
    ['startScreen', 'examScreen', 'statusScreen'].forEach(id => $(id).classList.toggle('hidden', id !== screen));
    window.scrollTo(0, 0);
  }
  function drawQuestion() {
    const item = order[index];
    $('currentNumber').textContent = String(index + 1).padStart(2, '0');
    $('totalNumber').textContent = `/ ${order.length}`;
    $('progressFill').style.width = `${(index / order.length) * 100}%`;
    $('category').textContent = item.category;
    $('questionLabel').textContent = `ВОПРОС ${index + 1} ИЗ ${order.length}`;
    $('questionText').textContent = item.question;
    $('choices').replaceChildren();
    $('nextButton').disabled = true;
    $('nextButton').innerHTML = index === order.length - 1 ? 'Отправить ответы <span class="arrow">→</span>' : 'Продолжить <span class="arrow">→</span>';
    shuffle(item.options).forEach(option => {
      const label = document.createElement('label');
      label.className = 'choice';
      const input = document.createElement('input');
      input.type = 'radio'; input.name = 'answer'; input.value = option.id;
      input.addEventListener('change', () => { $('nextButton').disabled = false; });
      const text = document.createElement('span'); text.textContent = option.text;
      label.append(input, text); $('choices').append(label);
    });
  }
  function receiptStatus(token) {
    return new Promise((resolve, reject) => {
      const nonce = newToken();
      const callbackName = `examReceive_${nonce}`;
      const script = document.createElement('script');
      const timer = setTimeout(() => finish(new Error('Сервис не ответил')), 7000);
      let finished = false;
      function finish(err, data) {
        if (finished) return;
        finished = true; clearTimeout(timer); delete window[callbackName]; script.remove();
        err ? reject(err) : resolve(data);
      }
      window[callbackName] = value => finish(null, value);
      script.onerror = () => finish(new Error('Нет связи с сервисом'));
      script.src = `${endpoint}?attempt=${encodeURIComponent(token)}&callback=${callbackName}`;
      document.head.append(script);
    });
  }
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function sendResult() {
    if (sending) return;
    sending = true;
    $('retryButton').classList.add('hidden');
    $('statusError').textContent = '';
    $('statusIcon').textContent = '…';
    $('statusTitle').textContent = 'Отправляем ответы';
    $('statusText').textContent = 'Не закрывайте страницу, пока не появится подтверждение.';
    const payload = { attempt, name: identity.name, passport: identity.passport, responses, startedAt, hiddenCount };
    try {
      const body = new URLSearchParams();
      body.set('payload', JSON.stringify(payload));
      // Формат простой формы позволяет отправить данные из GitHub Pages без CORS preflight.
      await fetch(endpoint, { method: 'POST', mode: 'no-cors', body });
      let confirmed = false;
      for (let i = 0; i < 15; i++) {
        await wait(2000);
        try {
          const result = await receiptStatus(attempt);
          if (result && result.status === 'accepted') { confirmed = true; break; }
        } catch (_) { /* Повторяем чтение квитанции при временной ошибке. */ }
      }
      if (!confirmed) throw new Error('Подтверждение записи не получено. Проверьте подключение и повторите отправку. Повтор не создаст вторую запись.');
      $('statusIcon').textContent = '✓';
      $('statusTitle').textContent = 'Ответы отправлены';
      $('statusText').textContent = 'Результат сохранён и доступен руководству для проверки. Вы можете закрыть эту страницу.';
      $('receipt').textContent = `Код попытки · ${attempt.slice(0, 12).toUpperCase()}`;
      $('receipt').classList.remove('hidden');
      identity = null; responses = {}; active = false;
    } catch (err) {
      $('statusIcon').textContent = '!';
      $('statusTitle').textContent = 'Не удалось подтвердить отправку';
      $('statusText').textContent = 'Не закрывайте страницу: ваши ответы ещё находятся здесь.';
      $('statusError').textContent = err.message || 'Проверьте интернет и попробуйте ещё раз.';
      $('retryButton').classList.remove('hidden');
    } finally { sending = false; }
  }
  $('questionCount').textContent = String(questions.length);
  $('identityForm').addEventListener('submit', event => {
    event.preventDefault();
    const name = $('name').value.trim(), passport = $('passport').value.trim();
    if (!name || !passport) { $('startError').textContent = 'Заполните имя персонажа и номер игрового паспорта.'; return; }
    if (!validEndpoint) { $('startError').textContent = 'Экзамен ещё не подключён к приёму результатов. Обратитесь к организатору.'; return; }
    if (!window.crypto || !crypto.getRandomValues) { $('startError').textContent = 'Откройте страницу по HTTPS в современном браузере.'; return; }
    identity = { name, passport }; attempt = newToken(); startedAt = new Date().toISOString();
    order = shuffle(questions); index = 0; responses = {}; hiddenCount = 0; active = true;
    show('examScreen'); drawQuestion();
  });
  $('nextButton').addEventListener('click', () => {
    const selected = document.querySelector('input[name="answer"]:checked');
    if (!selected) return;
    responses[order[index].id] = selected.value;
    index++;
    if (index < order.length) { drawQuestion(); window.scrollTo(0, 0); }
    else { active = false; show('statusScreen'); sendResult(); }
  });
  $('retryButton').addEventListener('click', sendResult);
  document.addEventListener('visibilitychange', () => { if (active && document.hidden) hiddenCount++; });
  window.addEventListener('beforeunload', event => { if (active || sending || (identity && Object.keys(responses).length)) { event.preventDefault(); event.returnValue = ''; } });
})();
