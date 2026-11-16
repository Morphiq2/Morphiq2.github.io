{
  const $ = s => document.querySelector(s);
  document.querySelectorAll('.yr').forEach(e => e.textContent = new Date().getFullYear());

  // light / dark toggle (remembered on this device)
  const root = document.documentElement, tb = $('#theme');
  const isDark = () => root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  const label = () => tb && tb.setAttribute('aria-label', isDark() ? 'Switch to light mode' : 'Switch to dark mode');
  label();
  if (tb) tb.addEventListener('click', () => {
    root.dataset.theme = isDark() ? 'light' : 'dark';
    try { localStorage.setItem('leiden-theme', root.dataset.theme); } catch (e) {}
    label();
  });

  // mobile menu
  const links = $('#links'), burger = $('#burger');
  if (burger) {
    burger.addEventListener('click', () => { const o = links.classList.toggle('open'); burger.setAttribute('aria-expanded', o); });
    links.addEventListener('click', e => { if (e.target.tagName === 'A') { links.classList.remove('open'); burger.setAttribute('aria-expanded', false); } });
  }

  // service picked from a link like contact.html#ict
  const svc = $('#qSvc');
  const PICK = {construction:0, food:1, ict:2, broadcasting:3, transport:4};
  if (svc && location.hash.slice(1) in PICK) svc.selectedIndex = PICK[location.hash.slice(1)];

  // credentials list (About page)
  const cl = $('#credList');
  if (cl) {
    const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>';
    const CREDS = [['PACRA','Patents and Companies Registration Agency'],['ZRA TPIN','Zambia Revenue Authority'],['Tax Clearance','Zambia Revenue Authority'],['NCC','National Council for Construction'],['ZPPA','Zambia Public Procurement Authority'],['NAPSA','National Pension Scheme Authority compliance'],['EIZ','Engineering Institution of Zambia']];
    cl.innerHTML = CREDS.map(([t, d]) => `<div class="cred"><i>${ICON}</i><div><b>${t}</b><span>${d}</span></div></div>`).join('')
      + `<a class="cred" href="contact.html" style="text-decoration:none;background:var(--char);border-color:var(--char)"><i style="background:rgba(255,255,255,.1);color:#fff">${ICON}</i><div><b style="color:#fff">Need copies?</b><span style="color:#bdb5b8">Ask us for any certificate</span></div></a>`;
  }

  // gentle reveal on scroll
  const els = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => es.forEach(x => { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } }), {threshold: .1});
    els.forEach(el => io.observe(el));
  } else els.forEach(el => el.classList.add('in'));

  // quote form: builds a WhatsApp message and an email — no server needed
  const form = $('#quote');
  if (form) {
    const WA = '260978312080', MAIL = 'leideninvestmentltd@gmail.com';
    form.addEventListener('submit', e => {
      e.preventDefault();
      const v = id => $(id).value.trim();
      if (!v('#qName') || !v('#qPhone') || !v('#qMsg')) { $('#qErr').textContent = 'Please fill in your name, phone number and what you need.'; return; }
      $('#qErr').textContent = '';
      const text = `Quote request — ${v('#qSvc')}\n\nName: ${v('#qName')}\nPhone: ${v('#qPhone')}` + (v('#qOrg') ? `\nOrganisation: ${v('#qOrg')}` : '') + `\n\n${v('#qMsg')}`;
      $('#sendWa').href = `https://wa.me/${WA}?text=${encodeURIComponent(text)}`;
      $('#sendMail').href = `mailto:${MAIL}?subject=${encodeURIComponent('Quote request — ' + v('#qSvc'))}&body=${encodeURIComponent(text)}`;
      $('#send').classList.add('on');
      $('#sendWa').focus();
    });
  }
}
