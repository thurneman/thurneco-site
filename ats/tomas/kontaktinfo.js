// Input is restricted to the partner's existing contactOf(candidate) result.
globalThis.TomasKontaktinfo = (() => {
  let viewer = "";
  const openCandidates = new Set();

  function reset() {
    viewer = "";
    openCandidates.clear();
  }

  function selectViewer(viewerId) {
    if (viewer !== viewerId) {
      reset();
      viewer = viewerId;
    }
  }

  function toggle(viewerId, candidateId) {
    selectViewer(viewerId);
    if (!viewerId || !candidateId) return false;
    if (openCandidates.delete(candidateId)) return false;
    openCandidates.add(candidateId);
    return true;
  }

  function isOpen(viewerId, candidateId) {
    selectViewer(viewerId);
    return Boolean(viewerId && candidateId && openCandidates.has(candidateId));
  }

  function escape(value) {
    return String(value).replace(/[&<>"']/g, character => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]
    ));
  }

  function field(label, value, href) {
    let content = value ? escape(value) : "Saknas";
    if (value && href) content = '<a href="' + escape(href) + '">' + content + '</a>';
    return '<dt>' + label + '</dt><dd>' + content + '</dd>';
  }

  function render(viewerId, candidateId, contact, editFields) {
    const open = isOpen(viewerId, candidateId);
    if (!viewerId || !candidateId) return "";
    const phone = String(contact?.phone || "").trim();
    const email = String(contact?.email || "").trim();
    const button = '<button type="button" class="btn small" data-dialog-kontakt="' +
      escape(candidateId) + '" aria-expanded="' + open + '">' +
      (open ? "Dölj kontaktinfo" : "Lås upp kontaktinfo") + '</button>';
    let details = "";
    if (open && editFields) {
      details = editFields();
    } else if (open && !phone && !email) {
      details = '<p class="dialog-kontakt-varden">Telefon och mejl saknas</p>';
    } else if (open) {
      const number = phone.replace(/[\s().-]/g, "");
      const tel = /^\+?\d+$/.test(number) ? "tel:" + number : "";
      const mailto = /^[^\s@?&#<>]+@[^\s@?&#<>]+\.[^\s@?&#<>]+$/.test(email)
        ? "mailto:" + encodeURIComponent(email).replace("%40", "@") : "";
      details = '<dl class="dialog-kontakt-varden">' +
        field("Telefon", phone, tel) + field("Mejl", email, mailto) + '</dl>';
    }
    return '<div class="dialog-kontaktinfo">' + button + details + '</div>';
  }

  return { render, toggle, isOpen, reset };
})();
