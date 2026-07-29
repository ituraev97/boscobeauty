// Отправляет заявки с сайта в Telegram.
// Netlify запускает эту функцию автоматически каждый раз, когда кто-то
// отправил форму (событие submission-created). Ничего вызывать вручную не нужно.
//
// Перед работой в Netlify нужно задать две переменные окружения:
//   TELEGRAM_BOT_TOKEN — токен бота от @BotFather
//   TELEGRAM_CHAT_ID   — id чата/группы, куда слать заявки

const FORM_TITLES = {
  'zayavka-main': 'Главная страница',
  'zayavka-manicure': 'Маникюр и педикюр',
  'zayavka-brows': 'Брови и ресницы',
  'zayavka-hair': 'Волосы',
  'zayavka-podology': 'Подология',
};

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

exports.handler = async (event) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.error('TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID не заданы в переменных окружения Netlify');
    // 200, чтобы Netlify не считал доставку формы неудачной — заявка всё равно сохранена в панели
    return { statusCode: 200, body: 'missing telegram config' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body).payload;
  } catch (err) {
    console.error('Не удалось разобрать тело запроса', err);
    return { statusCode: 200, body: 'bad payload' };
  }

  const data = (payload && payload.data) || {};
  const formName = (payload && payload.form_name) || '';

  if (!Object.prototype.hasOwnProperty.call(FORM_TITLES, formName)) {
    console.error('Неизвестная форма:', formName);
    return { statusCode: 200, body: 'unknown form' };
  }

  if (data['bot-field']) {
    console.error('Сработала honeypot-защита для формы', formName);
    return { statusCode: 200, body: 'spam' };
  }

  const name = String(data.name || '').trim();
  const phone = String(data.phone || '').trim();
  if (!name || !phone) {
    console.error('Пустое имя или телефон в заявке', formName);
    return { statusCode: 200, body: 'invalid payload' };
  }

  const section = FORM_TITLES[formName];

  const lines = [
    '🌿 <b>Новая заявка с сайта</b>',
    '',
    `👤 <b>Имя:</b> ${escapeHtml(name)}`,
    `📞 <b>Телефон:</b> ${escapeHtml(phone)}`,
    `💅 <b>Услуга:</b> ${escapeHtml(data.service)}`,
    `🕐 <b>Удобное время:</b> ${escapeHtml(data.time) || '—'}`,
    '',
    `📄 <b>Раздел:</b> ${escapeHtml(section)}`,
  ];

  if (data.page) lines.push(`🔗 <b>Страница:</b> ${escapeHtml(data.page)}`);

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: lines.join('\n'),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error('Telegram вернул ошибку:', res.status, detail);
    }
  } catch (err) {
    console.error('Не удалось отправить сообщение в Telegram', err);
  }

  return { statusCode: 200, body: 'ok' };
};
