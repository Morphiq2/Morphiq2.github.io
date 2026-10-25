// site.js — shared behaviour loaded at the end of every page.
(function () {
  // Footer year
  document.querySelectorAll('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });

  // Transparent nav over the dark page header (inner pages only)
  const nav = document.getElementById('navbar');
  const header = document.querySelector('.page-hero');
  const burger = document.getElementById('hamburger');
  if (!nav || !header) return;

  function update() {
    const menuOpen = burger && burger.classList.contains('open');
    const y = window.scrollY;
    const over = !menuOpen && y < header.offsetHeight - nav.offsetHeight;
    nav.classList.toggle('on-hero', over);
    nav.classList.toggle('dim', over && y > 20);
    if (over) nav.classList.remove('scrolled');
  }
  // Registered after each page's own handlers, so it runs last
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  if (burger) burger.addEventListener('click', update);
  document.querySelectorAll('.mobile-link').forEach(l => l.addEventListener('click', update));
  update();
})();
