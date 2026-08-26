// Normalise un numéro de téléphone pour permettre la comparaison
// entre formats différents ("06 12 34 56 78", "+33612345678", "0612345678"...).
function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  // Compare sur les 9 derniers chiffres significatifs (numéro français sans indicatif/0 initial).
  return digits.slice(-9);
}

function phonesMatch(a, b) {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return Boolean(na) && na === nb;
}

module.exports = { normalizePhone, phonesMatch };
