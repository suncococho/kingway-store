import { useEffect, useRef, useState } from "react";

function lockBodyScroll() {
  const body = document.body;
  const previous = {
    overflow: body.style.overflow,
    touchAction: body.style.touchAction,
    overscrollBehavior: body.style.overscrollBehavior
  };

  body.style.overflow = "hidden";
  body.style.touchAction = "none";
  body.style.overscrollBehavior = "contain";

  return () => {
    body.style.overflow = previous.overflow;
    body.style.touchAction = previous.touchAction;
    body.style.overscrollBehavior = previous.overscrollBehavior;
  };
}

function SignaturePad({ value, onChange }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const cleanupScrollLockRef = useRef(null);
  const draftDataRef = useRef("");
  const [draftData, setDraftData] = useState(value || "");
  const [hasDraft, setHasDraft] = useState(Boolean(value));

  const isConfirmed = Boolean(value);

  function getContext() {
    return canvasRef.current?.getContext("2d") || null;
  }

  function drawWhiteBackground(context, width, height) {
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.restore();
  }

  function setupCanvas(sourceImage = draftDataRef.current || value || "") {
    const canvas = canvasRef.current;
    const context = getContext();
    if (!canvas || !context) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(window.devicePixelRatio || 1, 1);
    const width = Math.max(Math.round(rect.width * dpr), 1);
    const height = Math.max(Math.round(rect.height * dpr), 1);

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.lineWidth = 3;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#111827";
    drawWhiteBackground(context, width, height);

    if (sourceImage) {
      const image = new Image();
      image.onload = () => {
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawWhiteBackground(context, width, height);
        context.drawImage(image, 0, 0, rect.width, rect.height);
      };
      image.src = sourceImage;
    }
  }

  useEffect(() => {
    draftDataRef.current = value || "";
    setDraftData(value || "");
    setHasDraft(Boolean(value));
    setupCanvas(value || "");
  }, [value]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const resizeObserver = new ResizeObserver(() => {
      setupCanvas(draftDataRef.current || value || "");
    });
    resizeObserver.observe(canvas);

    const preventTouchScroll = (event) => {
      if (drawingRef.current) {
        event.preventDefault();
      }
    };
    canvas.addEventListener("touchstart", preventTouchScroll, { passive: false });
    canvas.addEventListener("touchmove", preventTouchScroll, { passive: false });

    return () => {
      resizeObserver.disconnect();
      canvas.removeEventListener("touchstart", preventTouchScroll);
      canvas.removeEventListener("touchmove", preventTouchScroll);
      cleanupScrollLockRef.current?.();
      cleanupScrollLockRef.current = null;
    };
  }, [value]);

  function getPosition(event) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  function exportDraft() {
    const canvas = canvasRef.current;
    if (!canvas) {
      return "";
    }
    const nextDraft = canvas.toDataURL("image/png");
    draftDataRef.current = nextDraft;
    setDraftData(nextDraft);
    setHasDraft(true);
    return nextDraft;
  }

  function startDrawing(event) {
    event.preventDefault();
    const canvas = canvasRef.current;
    const context = getContext();
    if (!canvas || !context) {
      return;
    }

    cleanupScrollLockRef.current?.();
    cleanupScrollLockRef.current = lockBodyScroll();
    canvas.setPointerCapture?.(event.pointerId);

    if (isConfirmed) {
      onChange("");
    }

    drawingRef.current = true;
    const point = getPosition(event);
    context.beginPath();
    context.moveTo(point.x, point.y);
  }

  function moveDrawing(event) {
    if (!drawingRef.current) {
      return;
    }

    event.preventDefault();
    const context = getContext();
    if (!context) {
      return;
    }

    const point = getPosition(event);
    context.lineTo(point.x, point.y);
    context.stroke();
    exportDraft();
  }

  function stopDrawing(event) {
    if (!drawingRef.current) {
      return;
    }

    event?.preventDefault?.();
    drawingRef.current = false;
    exportDraft();

    if (event?.pointerId !== undefined) {
      canvasRef.current?.releasePointerCapture?.(event.pointerId);
    }

    cleanupScrollLockRef.current?.();
    cleanupScrollLockRef.current = null;
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    const context = getContext();
    if (!canvas || !context) {
      return;
    }

    drawWhiteBackground(context, canvas.width, canvas.height);
    draftDataRef.current = "";
    setDraftData("");
    setHasDraft(false);
    onChange("");
    setupCanvas("");
  }

  function confirmSignature() {
    if (!draftData) {
      return;
    }
    onChange(draftData);
  }

  return (
    <div className="signature-card">
      <p className="signature-hint">請在下方白色區域內簽名</p>
      <canvas
        ref={canvasRef}
        className="signature-pad"
        onPointerDown={startDrawing}
        onPointerMove={moveDrawing}
        onPointerUp={stopDrawing}
        onPointerCancel={stopDrawing}
        onPointerLeave={stopDrawing}
      />
      <div className="signature-actions">
        <button type="button" className="secondary-button" onClick={clearCanvas}>
          清除簽名
        </button>
        <button type="button" className="primary-button" onClick={confirmSignature} disabled={!hasDraft || isConfirmed}>
          {isConfirmed ? "簽名已確認" : "確認簽名"}
        </button>
      </div>
      <div className={`signature-status ${isConfirmed ? "confirmed" : ""}`}>
        {isConfirmed ? "簽名已確認" : "請先在下方簽名，再按「確認簽名」"}
      </div>
    </div>
  );
}

export default SignaturePad;
