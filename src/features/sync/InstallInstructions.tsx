import { Download, Share2, Smartphone } from "lucide-react";

export function InstallInstructions() {
  return (
    <section className="panel install-panel">
      <div className="panel__title">
        <Smartphone size={21} aria-hidden="true" />
        <h2>Zainstaluj aplikację</h2>
      </div>
      <p className="panel__description">
        Po instalacji aplikacja otwiera się jak zwykła aplikacja telefonu i
        zachowuje dostęp do wcześniej zsynchronizowanych danych.
      </p>

      <div className="install-steps">
        <article>
          <Share2 size={20} aria-hidden="true" />
          <div>
            <strong>iPhone</strong>
            <p>Safari → Udostępnij → Dodaj do ekranu początkowego</p>
          </div>
        </article>
        <article>
          <Download size={20} aria-hidden="true" />
          <div>
            <strong>Android</strong>
            <p>Chrome → Zainstaluj aplikację</p>
          </div>
        </article>
      </div>
    </section>
  );
}
