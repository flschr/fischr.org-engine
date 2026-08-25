// t()/currentLocale() für den ausgewerteten Stats-Ausschnitt (admin-stats-source.js).
//
// Der echte t() in 00a-i18n.js liest localStorage — im Testlauf ohne
// --localstorage-file wirft das. Diese Fassung liest dieselben Wörterbücher
// (kein eigenes, das mit der Zeit auseinanderlaufen könnte) und rechnet fest
// mit Deutsch, wie es die bestehenden Zusicherungen dieser Tests ohnehin schon
// tun.
module.exports = async function adminI18nStub() {
  const { dictDe } = await import("../../blog/admin/admin-src/00a1-i18n-de.js");
  const { dictDe2 } = await import("../../blog/admin/admin-src/00a1b-i18n-de-2.js");
  const { dictDe3 } = await import("../../blog/admin/admin-src/00a1c-i18n-de-3.js");
  const { dictDe4 } = await import("../../blog/admin/admin-src/00a1d-i18n-de-4.js");
  const dict = { ...dictDe, ...dictDe2, ...dictDe3, ...dictDe4 };

  function t(key, vars) {
    let text = dict[key] ?? key;
    if (vars) for (const name of Object.keys(vars)) text = text.replaceAll(`{${name}}`, () => String(vars[name]));
    return text;
  }

  return { t, currentLocale: () => "de-DE" };
};
