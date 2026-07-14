import warrantyRepairAdditionalTerms from "../../../shared/warrantyRepairAdditionalTerms.json";

export { warrantyRepairAdditionalTerms };

function WarrantyRepairAdditionalTerms() {
  return (
    <section className="terms-iframe-box" aria-labelledby="warranty-repair-additional-terms-title">
      <h3 id="warranty-repair-additional-terms-title">{warrantyRepairAdditionalTerms.title}</h3>
      <div className="terms-version">{warrantyRepairAdditionalTerms.version}</div>
      {warrantyRepairAdditionalTerms.sections.map((section) => (
        <section className="terms-section" key={section.title}>
          <h4>{section.title}</h4>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </section>
      ))}
    </section>
  );
}

export default WarrantyRepairAdditionalTerms;
