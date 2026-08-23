const link = document.querySelector(".page-start-link");

if (link) {
  const updateVisibility = () => {
    link.classList.toggle("is-visible", window.scrollY > 400);
  };

  updateVisibility();
  window.addEventListener("scroll", updateVisibility, { passive: true });
}
