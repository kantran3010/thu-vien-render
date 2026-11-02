// Xác nhận trước các thao tác nguy hiểm (CSP không cho phép onsubmit nội tuyến)
document.addEventListener('submit', (e) => {
  const msg = e.target.dataset.confirm;
  if (msg && !window.confirm(msg)) e.preventDefault();
});
