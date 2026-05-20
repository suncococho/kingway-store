import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

function normalizeImageUrl(imageUrl) {
  const value = String(imageUrl || "").trim();
  if (!value) {
    return "";
  }
  if (/^https?:\/\//i.test(value) || value.startsWith("data:image/")) {
    return value;
  }
  if (value.startsWith("//")) {
    return `https:${value}`;
  }
  if (value.startsWith("/files/")) {
    return value;
  }
  if (value.startsWith("files/")) {
    return `/${value}`;
  }
  if (value.startsWith("storage/products/")) {
    return `/files/products/${value.slice("storage/products/".length)}`;
  }
  if (value.startsWith("products/")) {
    return `/files/${value}`;
  }
  if (value.startsWith("wp-content/uploads/")) {
    return `https://kingway.tw/tainan/${value}`;
  }
  if (value.startsWith("/wp-content/uploads/")) {
    return `https://kingway.tw/tainan${value}`;
  }
  return value;
}

function ProductImageModal({ src, alt, onClose }) {
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="image-modal-backdrop" onClick={onClose} role="presentation">
      <div className="image-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="商品圖片放大檢視">
        <button type="button" className="image-modal-close" onClick={onClose} aria-label="關閉圖片">
          關閉
        </button>
        <div className="image-modal-body">
          <img className="image-modal-img" src={src} alt={alt} />
        </div>
      </div>
    </div>,
    document.body
  );
}

function ProductImage({ src, alt, className = "product-thumb", fallbackLabel = "無圖" }) {
  const normalizedSrc = useMemo(() => normalizeImageUrl(src), [src]);
  const [broken, setBroken] = useState(false);
  const [open, setOpen] = useState(false);
  const showImage = Boolean(normalizedSrc) && !broken;

  if (!showImage) {
    return <div className={`${className} product-thumb-fallback`}>{fallbackLabel}</div>;
  }

  return (
    <>
      <button type="button" className="product-image-button" onClick={() => setOpen(true)} aria-label={`查看${alt || "商品"}大圖`}>
        <img className={className} src={normalizedSrc} alt={alt} loading="lazy" onError={() => setBroken(true)} />
      </button>
      {open ? <ProductImageModal src={normalizedSrc} alt={alt} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export default ProductImage;
