const scrollToId = (id) => {
  const el = document.querySelector(id);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};

document.querySelectorAll('[data-cta="install"]').forEach((btn) => {
  btn.addEventListener('click', () => scrollToId('#setup'));
});

document.querySelectorAll('[data-cta="demo"]').forEach((btn) => {
  btn.addEventListener('click', () => scrollToId('#features'));
});
