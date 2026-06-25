import { useState } from "react";
import PageHelpModal from "./PageHelpModal";

function PageHelpButton({ help }) {
  const [open, setOpen] = useState(false);
  if (!help) return null;

  return (
    <div className="page-help-toolbar">
      <button type="button" className="secondary-button page-help-button" onClick={() => setOpen(true)}>
        使用說明
      </button>
      {open ? <PageHelpModal help={help} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

export default PageHelpButton;
