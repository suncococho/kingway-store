import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import ActionModal from "../components/ActionModal";
import AdminSectionHeader from "../components/AdminSectionHeader";
import DataTable from "../components/DataTable";
import DetailModal from "../components/DetailModal";
import FilterBar from "../components/FilterBar";
import FilterChips from "../components/FilterChips";
import PageHeader from "../components/PageHeader";
import ProductImage from "../components/ProductImage";
import SectionTabs from "../components/SectionTabs";
import StatusBadge from "../components/StatusBadge";
import { useFetchList } from "../hooks/useFetchList";
import { API_BASE_URL, apiRequest, apiUploadImage } from "../lib/api";
import { getCategoryLabel } from "../lib/display";
import { clearAuth, getStoredToken } from "../lib/auth";
import { PRODUCT_CATEGORY_LABELS, PRODUCT_CATEGORY_OPTIONS, deriveProductCategoryFromSku, normalizeProductCategory } from "../lib/productCategories";

const PRODUCT_EXPORT_FILENAME = "KINGWAY_product_export.xlsx";
const PRODUCT_IMPORT_TEMPLATE_FILENAME = "KINGWAY_product_import_template.xlsx";

function getStockTone(stock, reorderLevel) {
  if (Number(stock) <= 0) {
    return "danger";
  }
  if (Number(stock) <= Number(reorderLevel || 0)) {
    return "warning";
  }
  return "success";
}

function getStockLabel(stock, reorderLevel) {
  if (Number(stock) <= 0) {
    return "無庫存";
  }
  if (Number(stock) <= Number(reorderLevel || 0)) {
    return "低庫存";
  }
  return "有庫存";
}

function formatCurrency(value) {
  return `NT$${Number(value || 0).toFixed(0)}`;
}

function revokePreviewUrl(url) {
  if (typeof url === "string" && url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

function buildProductPreviewUrl(imagePath, productId) {
  const value = String(imagePath || "").trim();
  if (!value) {
    return "";
  }
  if (/^https?:\/\//i.test(value) || value.startsWith("data:image/") || value.startsWith("/api/")) {
    return value;
  }
  if (value.startsWith("/files/products/") || value.startsWith("files/products/") || value.startsWith("storage/products/") || value.startsWith("products/")) {
    return productId ? `/api/products/${productId}/image` : "";
  }
  return value;
}

function ProductsPage() {
  const location = useLocation();
  const { items, loading, error, refetch } = useFetchList("/products");
  const categories = useFetchList("/product-categories");
  const [form, setForm] = useState({
    name: "",
    sku: "",
    category: "OT",
    categoryId: "",
    price: "",
    stock: "",
    reorderLevel: "0",
    imageUrl: "",
    costPrice: "",
    location: "",
    description: ""
  });
  const [submitting, setSubmitting] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [detailImageUploading, setDetailImageUploading] = useState(false);
  const [imagePreviewUrl, setImagePreviewUrl] = useState("");
  const [detailImagePreviewUrl, setDetailImagePreviewUrl] = useState("");
  const [stockDrafts, setStockDrafts] = useState({});
  const [stockSavingId, setStockSavingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [stockFilter, setStockFilter] = useState("ALL");
  const [section, setSection] = useState("LIST");
  const [detailProductId, setDetailProductId] = useState(null);
  const [detailForm, setDetailForm] = useState({
    sku: "",
    name: "",
    category: "OT",
    categoryId: "",
    price: "",
    reorderLevel: "",
    imageUrl: "",
    costPrice: "",
    location: "",
    description: "",
    isActive: true
  });
  const [searchMode, setSearchMode] = useState(false);
  const [searchScope, setSearchScope] = useState("ALL");
  const [batchMode, setBatchMode] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState([]);
  const [productStep, setProductStep] = useState(1);
  const [warningModal, setWarningModal] = useState(null);
  const [categoryForm, setCategoryForm] = useState({ id: null, code: "", name: "", sortOrder: "0" });
  const [categorySaving, setCategorySaving] = useState(false);
  const [downloadLoading, setDownloadLoading] = useState(null);
  const [downloadError, setDownloadError] = useState("");
  const importFileInputRef = useRef(null);
  const [importFile, setImportFile] = useState(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importApplyLoading, setImportApplyLoading] = useState(false);
  const [importError, setImportError] = useState("");
  const [importSuccess, setImportSuccess] = useState("");
  const [importResult, setImportResult] = useState(null);
  const [showImportPreviewDetails, setShowImportPreviewDetails] = useState(true);
  const [importApplyConfirm, setImportApplyConfirm] = useState(null);
  const currentSkuPreview = form.sku.trim() || "分類變更後會自動產生";

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const nextSection = params.get("section");
    if (nextSection && ["LIST", "CREATE", "CATEGORY", "SKU", "IMAGES", "STOCK"].includes(nextSection)) {
      setSection(nextSection);
    }
  }, [location.search]);

  useEffect(() => {
    setStockDrafts((current) => {
      const next = { ...current };
      for (const item of items) {
        const key = String(item.id);
        if (next[key] === undefined) {
          next[key] = String(item.stock ?? 0);
        }
      }
      return next;
    });
  }, [items]);

  const productRows = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        categoryLabel: item.categoryLabel || getCategoryLabel(item.category),
        stockTone: getStockTone(item.stock, item.reorderLevel),
        stockLabel: getStockLabel(item.stock, item.reorderLevel),
        statusLabel: item.isActive ? "上架中" : "未上架"
      })),
    [items]
  );

  const categoryOptions = useMemo(() => {
    const apiCategories = categories.items
      .filter((item) => item.isActive)
      .map((item) => ({
        key: item.code,
        label: item.name,
        value: String(item.id),
        id: item.id,
        code: item.code,
        name: item.name,
        isActive: item.isActive,
        productCount: item.productCount || 0
      }));

    if (apiCategories.length) {
      return apiCategories;
    }

    return PRODUCT_CATEGORY_OPTIONS.map(({ key, label }) => ({
      key,
      label,
      value: key,
      id: null,
      code: key,
      name: label,
      isActive: true,
      productCount: productRows.filter((item) => item.category === key).length
    }));
  }, [categories.items, productRows]);

  const categoryLookupByValue = useMemo(() => {
    const lookup = new Map();
    for (const option of categoryOptions) {
      lookup.set(String(option.value), option);
      lookup.set(String(option.code), option);
    }
    return lookup;
  }, [categoryOptions]);

  const filteredItems = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    return productRows.filter((item) => {
      if (categoryFilter !== "ALL" && item.category !== categoryFilter) {
        return false;
      }
      if (statusFilter !== "ALL" && ((statusFilter === "ACTIVE") !== Boolean(item.isActive))) {
        return false;
      }
      if (stockFilter === "LOW" && item.stockLabel !== "低庫存") {
        return false;
      }
      if (stockFilter === "IN" && item.stockLabel === "無庫存") {
        return false;
      }
      if (stockFilter === "EMPTY" && item.stockLabel !== "無庫存") {
        return false;
      }
      if (!keyword) {
        return true;
      }

      const haystack = `${item.name} ${item.sku} ${item.categoryLabel}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [productRows, searchTerm, categoryFilter, statusFilter, stockFilter]);

  const detailProduct = productRows.find((item) => item.id === detailProductId) || null;

  function getSelectedCategoryValue(categoryId, categoryCode) {
    if (categoryId) {
      return String(categoryId);
    }
    return categoryCode || "OT";
  }

  function handleProductCategoryChange(event) {
    const option = categoryLookupByValue.get(String(event.target.value));
    if (!option) {
      return;
    }
    setForm((current) => ({
      ...current,
      category: option.code,
      categoryId: option.id ? String(option.id) : ""
    }));
  }

  function handleDetailProductCategoryChange(event) {
    const option = categoryLookupByValue.get(String(event.target.value));
    if (!option) {
      return;
    }
    setDetailForm((current) => ({
      ...current,
      category: option.code,
      categoryId: option.id ? String(option.id) : ""
    }));
  }

  useEffect(() => {
    if (!detailProduct) {
      return;
    }
    const normalizedCategory = normalizeProductCategory(detailProduct.category || deriveProductCategoryFromSku(detailProduct.sku));
    setDetailImagePreviewUrl((current) => {
      revokePreviewUrl(current);
      return "";
    });
    setDetailForm({
      sku: detailProduct.sku || "",
      name: detailProduct.name || "",
      category: normalizedCategory,
      categoryId: detailProduct.categoryId ? String(detailProduct.categoryId) : "",
      price: String(detailProduct.price ?? ""),
      reorderLevel: String(detailProduct.reorderLevel ?? ""),
      imageUrl: detailProduct.imagePath || "",
      costPrice: String(detailProduct.costPrice ?? ""),
      location: detailProduct.location || "",
      description: detailProduct.description || "",
      isActive: Boolean(detailProduct.isActive)
    });
  }, [detailProduct]);

  useEffect(
    () => () => {
      revokePreviewUrl(imagePreviewUrl);
      revokePreviewUrl(detailImagePreviewUrl);
    },
    [imagePreviewUrl, detailImagePreviewUrl]
  );

  useEffect(() => {
    if (section !== "CREATE" || !form.category) {
      return;
    }

    let cancelled = false;

    async function loadNextSku() {
      try {
        const params = new URLSearchParams();
        if (form.categoryId) {
          params.set("categoryId", form.categoryId);
        }
        params.set("category", form.category);
        const data = await apiRequest(`/products/next-sku?${params.toString()}`);
        if (!cancelled && data?.sku) {
          setForm((current) => ({
            ...current,
            sku: data.sku
          }));
        }
      } catch (error) {
        // Keep the form usable even if SKU generation fails.
      }
    }

    loadNextSku();

    return () => {
      cancelled = true;
    };
  }, [form.category, form.categoryId, section]);

  useEffect(() => {
    if (section !== "LIST") {
      setSearchMode(false);
      setBatchMode(false);
      clearBatchSelection();
    }
  }, [section]);

  function toggleSelectedProduct(productId) {
    setSelectedProductIds((current) =>
      current.includes(productId) ? current.filter((id) => id !== productId) : [...current, productId]
    );
  }

  function clearBatchSelection() {
    setSelectedProductIds([]);
  }

  function openSearch(scope = "ALL") {
    setSection("LIST");
    setSearchScope(scope);
    setSearchMode(true);
  }

  function closeSearch() {
    setSearchMode(false);
  }

  function handleChange(event) {
    const { name, value } = event.target;
    if (name === "imageUrl") {
      setImagePreviewUrl((current) => {
        revokePreviewUrl(current);
        return "";
      });
    }
    setForm((current) => ({
      ...current,
      [name]: value
    }));
  }

  async function uploadProductImage(file) {
    const data = await apiUploadImage("/products/images", file);
    return data.imageUrl;
  }

  async function handleImageFile(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setImageUploading(true);
    try {
      const localPreviewUrl = URL.createObjectURL(file);
      const imageUrl = await uploadProductImage(file);
      setForm((current) => ({ ...current, imageUrl }));
      setImagePreviewUrl((current) => {
        revokePreviewUrl(current);
        return localPreviewUrl;
      });
    } catch (error) {
      alert(error.message || "圖片上傳失敗");
    } finally {
      setImageUploading(false);
      event.target.value = "";
    }
  }

  async function handleDetailImageFile(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setDetailImageUploading(true);
    try {
      const localPreviewUrl = URL.createObjectURL(file);
      const imageUrl = await uploadProductImage(file);
      setDetailForm((current) => ({ ...current, imageUrl }));
      setDetailImagePreviewUrl((current) => {
        revokePreviewUrl(current);
        return localPreviewUrl;
      });
    } catch (error) {
      alert(error.message || "圖片上傳失敗");
    } finally {
      setDetailImageUploading(false);
      event.target.value = "";
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);

    try {
      const data = await apiRequest("/products", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          sku: form.sku,
          category: form.category,
          categoryId: form.categoryId ? Number(form.categoryId) : null,
          price: Number(form.price),
          stock: Number(form.stock),
          reorderLevel: Number(form.reorderLevel),
          imageUrl: form.imageUrl,
          costPrice: Number(form.costPrice || 0),
          location: form.location,
          description: form.description
        })
      });

      setForm({
        name: "",
        sku: "",
        category: "OT",
        categoryId: "",
        price: "",
        stock: "",
        reorderLevel: "0",
        imageUrl: "",
        costPrice: "",
        location: "",
        description: ""
      });
      setImagePreviewUrl((current) => {
        revokePreviewUrl(current);
        return "";
      });
      await refetch();
      setDetailProductId(data.id);
      setSection("LIST");
      setProductStep(1);
    } catch (requestError) {
      alert(requestError.message || "新增商品失敗");
    } finally {
      setSubmitting(false);
    }
  }

  async function generateSku() {
    try {
      const params = new URLSearchParams();
      if (form.categoryId) {
        params.set("categoryId", form.categoryId);
      }
      params.set("category", form.category);
      const data = await apiRequest(`/products/next-sku?${params.toString()}`);
      setForm((current) => ({ ...current, sku: data.sku }));
    } catch (error) {
      alert(error.message || "產生 SKU 失敗");
    }
  }

  async function saveProductDetail(event) {
    event.preventDefault();

    if (!detailProduct) {
      return;
    }

    try {
      await apiRequest(`/products/${detailProduct.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          sku: detailForm.sku,
          name: detailForm.name,
          category: detailForm.category,
          categoryId: detailForm.categoryId ? Number(detailForm.categoryId) : null,
          price: Number(detailForm.price || 0),
          reorderLevel: Number(detailForm.reorderLevel || 0),
          imageUrl: detailForm.imageUrl,
          costPrice: Number(detailForm.costPrice || 0),
          location: detailForm.location,
          description: detailForm.description,
          isActive: detailForm.isActive
        })
      });
      await refetch();
      alert("商品已更新");
    } catch (error) {
      alert(error.message || "更新商品失敗");
    }
  }

  async function saveCategory(event) {
    event.preventDefault();
    setCategorySaving(true);

    try {
      const payload = {
        code: categoryForm.code,
        name: categoryForm.name,
        sortOrder: Number(categoryForm.sortOrder || 0)
      };
      if (categoryForm.id) {
        await apiRequest(`/product-categories/${categoryForm.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
      } else {
        await apiRequest("/product-categories", {
          method: "POST",
          body: JSON.stringify(payload)
        });
      }
      setCategoryForm({ id: null, code: "", name: "", sortOrder: "0" });
      await categories.refetch();
    } catch (error) {
      alert(error.message || "儲存分類失敗");
    } finally {
      setCategorySaving(false);
    }
  }

  async function deactivateCategory(category) {
    if (!category?.id) {
      return;
    }
    setCategorySaving(true);
    try {
      await apiRequest(`/product-categories/${category.id}`, { method: "DELETE" });
      await categories.refetch();
    } catch (error) {
      alert(error.message || "停用分類失敗");
    } finally {
      setCategorySaving(false);
    }
  }

  function editCategory(category) {
    setCategoryForm({
      id: category.id,
      code: category.code || "",
      name: category.name || "",
      sortOrder: String(category.sortOrder ?? 0)
    });
  }

  function handleStockDraftChange(productId, value) {
    if (value === "") {
      setStockDrafts((current) => ({ ...current, [productId]: "" }));
      return;
    }

    if (!/^\d+$/.test(value)) {
      return;
    }

    setStockDrafts((current) => ({ ...current, [productId]: value }));
  }

  async function saveStock(product) {
    const draftValue = stockDrafts[String(product.id)];
    if (draftValue === "" || draftValue === undefined) {
      alert("請輸入庫存數量");
      return;
    }

    const nextStock = Number(draftValue);
    setStockSavingId(product.id);

    try {
      await apiRequest("/inventory/movements", {
        method: "POST",
        body: JSON.stringify({
          productId: product.id,
          type: "ADJUST",
          qty: nextStock,
          note: "商品管理頁直接調整庫存"
        })
      });
      await refetch();
    } catch (requestError) {
      alert(requestError.message || "更新庫存失敗");
    } finally {
      setStockSavingId(null);
    }
  }

  function buildDownloadUrl(path) {
    return `${API_BASE_URL}${path}`;
  }

  async function downloadBinaryFile(path) {
    const token = getStoredToken();
    const response = await fetch(buildDownloadUrl(path), {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });

    if (!response.ok) {
      if (response.status === 401) {
        clearAuth();
      }
      const rawText = await response.text();
      let message = "下載失敗";
      try {
        const parsed = JSON.parse(rawText || "{}");
        if (parsed?.message) {
          message = parsed.message;
        }
      } catch (_error) {
        if (rawText) {
          message = rawText;
        }
      }
      throw new Error(message);
    }

    return response;
  }

  function parseContentDispositionFilename(contentDisposition) {
    if (!contentDisposition) {
      return null;
    }
    const filenameMatch = /filename\*=UTF-8''([^;]+)|filename="?([^\";]+)"?/i.exec(contentDisposition);
    const encoded = filenameMatch?.[1] || filenameMatch?.[2];
    if (!encoded) {
      return null;
    }
    try {
      return decodeURIComponent(encoded);
    } catch (_error) {
      return encoded;
    }
  }

  async function saveBlobToFile(response, fallbackFilename) {
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    const responseFilename = parseContentDispositionFilename(response.headers.get("content-disposition"));
    link.download = responseFilename || fallbackFilename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  }

  async function handleDownloadExport() {
    setDownloadError("");
    setDownloadLoading("export");
    try {
      const response = await downloadBinaryFile("/products/export");
      await saveBlobToFile(response, PRODUCT_EXPORT_FILENAME);
    } catch (error) {
      setDownloadError(error.message || "匯出失敗");
    } finally {
      setDownloadLoading(null);
    }
  }

  async function handleDownloadTemplate() {
    setDownloadError("");
    setDownloadLoading("template");
    try {
      const response = await downloadBinaryFile("/products/import-template");
      await saveBlobToFile(response, PRODUCT_IMPORT_TEMPLATE_FILENAME);
    } catch (error) {
      setDownloadError(error.message || "下載範本失敗");
    } finally {
      setDownloadLoading(null);
    }
  }

  async function readErrorMessage(response, fallbackMessage = "請求失敗") {
    const rawText = await response.text();
    try {
      const payload = JSON.parse(rawText || "{}");
      if (payload?.message) {
        return payload.message;
      }
    } catch (_error) {
      if (rawText) {
        return rawText;
      }
    }
    return `${fallbackMessage}（${response.status}）`;
  }

  function triggerImportUpload() {
    if (importLoading || downloadLoading) {
      return;
    }
    setImportError("");
    if (importFileInputRef.current) {
      importFileInputRef.current.click();
    }
  }

  function formatImportActionLabel(action) {
    if (action === "create") {
      return "新增予定";
    }
    if (action === "update") {
      return "更新予定";
    }
    return "錯誤";
  }

  async function handleImportFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setImportFile(file);
    setImportError("");
    setImportSuccess("");
    setImportResult(null);
    setImportApplyConfirm(null);
    setShowImportPreviewDetails(true);
    setImportLoading(true);

    try {
      const response = await fetch(buildDownloadUrl("/products/import?dryRun=true"), {
        method: "POST",
        headers: {
          Authorization: getStoredToken() ? `Bearer ${getStoredToken()}` : "",
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        },
        body: file
      });

      if (!response.ok) {
        if (response.status === 401) {
          clearAuth();
        }
        const message = await readErrorMessage(response, "匯入預覽請求失敗");
        throw new Error(message);
      }

      const payload = await response.json();
      if (!payload || typeof payload !== "object") {
        throw new Error("回傳資料格式不正確");
      }
      setImportResult(payload);
      if (!payload.ok) {
        setImportError(payload.errors?.[0]?.message || "匯入資料驗證失敗");
      }
    } catch (error) {
      setImportError(error.message || "匯入預覽失敗");
    } finally {
      setImportLoading(false);
      event.target.value = "";
    }
  }

  function getImportPreviewSummary() {
    const createCount = Number(importResult?.createCount || 0);
    const updateCount = Number(importResult?.updateCount || 0);
    const errorCount = Number(importResult?.errors?.length || 0);
    return {
      okToApply: importResult?.ok && !errorCount,
      createCount,
      updateCount,
      errorCount
    };
  }

  async function openImportApplyConfirm() {
    const summary = getImportPreviewSummary();
    if (!summary.okToApply) {
      setImportError("目前匯入資料有錯誤，無法套用");
      return;
    }

    if (!importFile) {
      setImportError("尚未選擇匯入檔案");
      return;
    }

    setImportApplyConfirm({
      createCount: summary.createCount,
      updateCount: summary.updateCount,
      errorCount: summary.errorCount,
      totalRows: Number(importResult?.totalRows || 0)
    });
  }

  async function executeApplyImport() {
    setImportApplyConfirm(null);
    if (!importFile) {
      setImportError("尚未選擇匯入檔案");
      return;
    }

    if (!importResult?.ok || (importResult?.errors || []).length > 0) {
      setImportError("目前匯入資料有錯誤，無法套用");
      return;
    }

    const { errorCount } = getImportPreviewSummary();
    if (errorCount) {
      setImportError("目前有錯誤資料，請先修正後再套用");
      return;
    }

    setImportError("");
    setImportSuccess("");
    setImportApplyLoading(true);

    try {
      const response = await fetch(buildDownloadUrl("/products/import?apply=true"), {
        method: "POST",
        headers: {
          Authorization: getStoredToken() ? `Bearer ${getStoredToken()}` : "",
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        },
        body: importFile
      });

      if (!response.ok) {
        if (response.status === 401) {
          clearAuth();
        }
        const message = await readErrorMessage(response, "匯入套用失敗");
        throw new Error(message);
      }

      const payload = await response.json();
      if (!payload || typeof payload !== "object") {
        throw new Error("回傳資料格式不正確");
      }
      setImportResult(payload);
      if (!payload.ok) {
        setImportError(payload.errors?.[0]?.message || "匯入套用失敗");
        return;
      }
      setImportSuccess("商品匯入完成");
      setImportFile(null);
      await refetch();
    } catch (error) {
      setImportError(error.message || "匯入套用失敗");
    } finally {
      setImportApplyLoading(false);
    }
  }

  const columns = [
    batchMode
      ? {
          key: "select",
          label: "",
          render: (row) => (
            <button
              type="button"
              className={`product-select-circle${selectedProductIds.includes(row.id) ? " product-select-circle-active" : ""}`}
              onClick={() => toggleSelectedProduct(row.id)}
              aria-label={`選取 ${row.name}`}
            >
              {selectedProductIds.includes(row.id) ? "✓" : ""}
            </button>
          )
        }
      : null,
    {
      key: "identity",
      label: "商品",
      mobileHidden: true,
      render: (row) => (
        <div className="product-identity">
          <ProductImage src={row.imageUrl} alt={row.name} />
          <div className="identity-copy">
            <div className="identity-title">{row.name}</div>
            <div className="identity-subtitle">{row.categoryLabel}</div>
          </div>
        </div>
      )
    },
    { key: "sku", label: "SKU", mobileHidden: true },
    {
      key: "price",
      label: "售價",
      render: (row) => formatCurrency(row.price),
      mobileHidden: true
    },
    {
      key: "stockStatus",
      label: "庫存",
      render: (row) => (
        <div className="stack-meta">
          <StatusBadge tone={row.stockTone}>{row.stockLabel}</StatusBadge>
          <span>{row.stock}</span>
        </div>
      ),
      mobileHidden: true
    },
    {
      key: "status",
      label: "狀態",
      render: (row) => <StatusBadge tone={row.isActive ? "success" : "neutral"}>{row.statusLabel}</StatusBadge>,
      mobileHidden: true
    },
    {
      key: "actions",
      label: "操作",
      render: (row) => (
        <button type="button" className="secondary-button" onClick={() => setDetailProductId(row.id)}>
          查看詳情
        </button>
      ),
      mobileHidden: true
    }
  ];

  const sectionItems = [
    { key: "LIST", label: "商品列表" },
    { key: "CREATE", label: "新增商品" },
    { key: "CATEGORY", label: "分類管理" },
    { key: "SKU", label: "SKU / 規則" },
    { key: "IMAGES", label: "圖片管理" },
    { key: "STOCK", label: "庫存調整" }
  ];

  const categoryChipItems = [
    { key: "ALL", label: "全部分類" },
    ...categoryOptions.map((item) => ({ key: item.code, label: item.label }))
  ];
  const statusChipItems = [
    { key: "ALL", label: "全部狀態" },
    { key: "ACTIVE", label: "上架中" },
    { key: "INACTIVE", label: "未上架" }
  ];
  const stockChipItems = [
    { key: "ALL", label: "全部庫存" },
    { key: "IN", label: "有庫存" },
    { key: "LOW", label: "低庫存" },
    { key: "EMPTY", label: "無庫存" }
  ];

  const productSteps = [
    { number: 1, title: "商品名稱與分類", tone: form.name && form.category ? "green" : "blue" },
    { number: 2, title: "SKU 與庫存", tone: form.sku && form.stock !== "" ? "green" : productStep === 2 ? "blue" : "yellow" },
    { number: 3, title: "價格", tone: form.price !== "" ? "green" : productStep === 3 ? "blue" : "yellow" },
    { number: 4, title: "商品圖片", tone: form.imageUrl ? "green" : productStep === 4 ? "blue" : "yellow" },
    { number: 5, title: "確認", tone: productStep === 5 ? "blue" : "yellow" }
  ];

  function warnProductStep(stepName) {
    setWarningModal({
      title: "請依照商品建立步驟",
      message: `請先完成上一個步驟：${stepName}`
    });
  }

  function goToProductStep(nextStep) {
    if (nextStep > 1 && (!form.name.trim() || !form.category)) {
      warnProductStep("商品名稱與分類");
      return;
    }
    if (nextStep > 2 && (!form.sku.trim() || form.stock === "")) {
      warnProductStep("SKU 與庫存");
      return;
    }
    if (nextStep > 3 && form.price === "") {
      warnProductStep("價格");
      return;
    }
    setProductStep(nextStep);
  }

  const productWizardProgress = (
    <div className="wizard-progress">
      {productSteps.map((step) => (
        <button
          key={step.number}
          type="button"
          className={`wizard-step-card wizard-step-${step.tone}${productStep === step.number ? " wizard-step-active" : ""}`}
          onClick={() => goToProductStep(step.number)}
        >
          <span>Step {step.number}</span>
          <strong>{step.title}</strong>
        </button>
      ))}
    </div>
  );

  const importPreviewColumns = [
    { key: "row", label: "列" },
    { key: "sku", label: "SKU" },
    { key: "name", label: "商品名稱" },
    {
      key: "action",
      label: "結果",
      render: (row) => <StatusBadge tone={row.action === "create" ? "success" : row.action === "update" ? "warning" : "danger"}>{formatImportActionLabel(row.action)}</StatusBadge>
    },
    { key: "message", label: "訊息" }
  ];

  return (
    <div>
      <PageHeader title="商品管理" description="商品列表、設定與圖片管理統一使用 POS 同一套資訊架構與元件語言。" />
      <SectionTabs items={sectionItems} value={section} onChange={setSection} label="商品子功能" />
      {searchMode && section === "LIST" ? (
        <section className="admin-panel product-search-screen">
          <div className="search-screen-header">
            <button type="button" className="secondary-button" onClick={closeSearch}>
              取消
            </button>
            <div>
              <div className="section-title">搜尋商品</div>
              <div className="muted-text">快速查找商品名稱、SKU 或分類。</div>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setSearchTerm("");
                setSearchScope("ALL");
              }}
            >
              清除
            </button>
          </div>
          <FilterBar compact>
            <label className="form-field">
              <span>搜尋</span>
              <input type="text" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="輸入關鍵字" />
            </label>
          </FilterBar>
          <FilterChips
            items={[
              { key: "ALL", label: "全部商品" },
              { key: "SKU", label: "SKU" },
              { key: "CATEGORY", label: "分類" }
            ]}
            value={searchScope}
            onChange={setSearchScope}
          />
          <DataTable
            columns={columns.filter(Boolean)}
            rows={filteredItems.filter((item) => {
              const keyword = searchTerm.trim().toLowerCase();
              if (!keyword) {
                return true;
              }
              if (searchScope === "SKU") {
                return `${item.sku}`.toLowerCase().includes(keyword);
              }
              if (searchScope === "CATEGORY") {
                return `${item.categoryLabel}`.toLowerCase().includes(keyword);
              }
              return `${item.name} ${item.sku} ${item.categoryLabel}`.toLowerCase().includes(keyword);
            })}
            emptyText="目前沒有符合條件的搜尋結果。"
            cardTitle={(row) => (
              <div className="product-identity">
                {batchMode ? (
                  <button
                    type="button"
                    className={`product-select-circle${selectedProductIds.includes(row.id) ? " product-select-circle-active" : ""}`}
                    onClick={() => toggleSelectedProduct(row.id)}
                    aria-label={`選取 ${row.name}`}
                  >
                    {selectedProductIds.includes(row.id) ? "✓" : ""}
                  </button>
                ) : null}
                <ProductImage src={row.imageUrl} alt={row.name} />
                <div className="identity-copy">
                  <div className="identity-title">{row.name}</div>
                  <div className="identity-subtitle">{row.categoryLabel}</div>
                </div>
              </div>
            )}
            cardDescription={(row) => `SKU：${row.sku}`}
            cardBadges={(row) => (
              <>
                <StatusBadge tone={row.stockTone}>{row.stockLabel}</StatusBadge>
                <StatusBadge tone={row.isActive ? "success" : "neutral"}>{row.statusLabel}</StatusBadge>
              </>
            )}
            cardFooter={(row) => (
              <div className="field-grid">
                <div className="field-item">
                  <div className="field-label">售價</div>
                  <div className="field-value">{formatCurrency(row.price)}</div>
                </div>
                <div className="field-item">
                  <div className="field-label">庫存</div>
                  <div className="field-value">{row.stock}</div>
                </div>
                <div className="field-item">
                  <button type="button" className="secondary-button" onClick={() => setDetailProductId(row.id)}>
                    查看詳情
                  </button>
                </div>
              </div>
            )}
          />
        </section>
      ) : null}

      <div className="section-panel">
        {section === "LIST" && !searchMode ? (
          <section className="admin-panel">
            <AdminSectionHeader
              eyebrow="商品列表"
              title="商品總覽"
              description="主畫面只保留商品核心資訊，次要欄位改放詳情視窗與子功能頁籤。"
              badges={
                <>
                  <StatusBadge tone="info">商品 {productRows.length}</StatusBadge>
                  <StatusBadge tone="warning">低庫存 {productRows.filter((item) => item.stockLabel === "低庫存").length}</StatusBadge>
                </>
              }
              actions={
                <>
                  <button type="button" className="secondary-button" onClick={() => openSearch("ALL")}>
                    搜尋
                  </button>
                  <button type="button" className="secondary-button" onClick={() => openSearch("SKU")}>
                    條碼
                  </button>
                  <button
                    type="button"
                    className={`secondary-button${batchMode ? " section-tab-active" : ""}`}
                    onClick={() => {
                      setBatchMode((current) => !current);
                      if (batchMode) {
                        clearBatchSelection();
                      }
                    }}
                  >
                    批次
                  </button>
                  <button type="button" className="secondary-button" onClick={() => setSection("CREATE")}>
                    新增
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={handleDownloadExport}
                    disabled={Boolean(downloadLoading)}
                  >
                    {downloadLoading === "export" ? "匯出中..." : "匯出商品"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={handleDownloadTemplate}
                    disabled={Boolean(downloadLoading)}
                  >
                    {downloadLoading === "template" ? "下載中..." : "下載匯入範本"}
                  </button>
                  <button type="button" className="secondary-button" onClick={triggerImportUpload} disabled={Boolean(importLoading) || Boolean(downloadLoading)}>
                    {importLoading ? "匯入預覽中..." : "匯入商品"}
                  </button>
                  <input
                    ref={importFileInputRef}
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={handleImportFileChange}
                    style={{ display: "none" }}
                  />
                </>
              }
            />
            {downloadError ? <div className="error-banner">{downloadError}</div> : null}
            {importError ? <div className="error-banner">{importError}</div> : null}
            {importSuccess ? <div className="success-banner">{importSuccess}</div> : null}
            {!downloadError && downloadLoading ? <div className="loading-state">檔案下載中，請稍候...</div> : null}
            {importResult ? (
              <section className="admin-subpanel compact">
                <div className="section-title">匯入結果預覽</div>
                <div className="admin-summary-grid">
                  <article className="admin-summary-card">
                    <div className="admin-summary-label">新增予定</div>
                    <div className="admin-summary-value">{importResult.createCount}</div>
                  </article>
                  <article className="admin-summary-card">
                    <div className="admin-summary-label">更新予定</div>
                    <div className="admin-summary-value">{importResult.updateCount}</div>
                  </article>
                  <article className="admin-summary-card">
                    <div className="admin-summary-label">錯誤</div>
                    <div className="admin-summary-value">{(importResult.errors || []).length}</div>
                  </article>
                </div>
                <div className="admin-summary-note">匯入總列數：{importResult.totalRows}</div>
                {!importResult.dryRun ? (
                  <div className="admin-summary-note">
                    本次套用已完成，成功 {importResult.appliedRows?.length || 0} 筆
                  </div>
                ) : null}
                {importResult?.preview?.length ? (
                  <div className="admin-summary-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setShowImportPreviewDetails((current) => !current)}
                    >
                      {showImportPreviewDetails ? "收合詳細預覽" : "展開詳細預覽"}
                    </button>
                  </div>
                ) : null}
                {showImportPreviewDetails ? (
                  <DataTable
                    columns={importPreviewColumns}
                    rows={importResult.preview || []}
                    emptyText="預覽資料為空。"
                    cardTitle={(row) => `第 ${row.row} 列`}
                    cardDescription={(row) => `SKU：${row.sku}`}
                    cardBadges={(row) => <StatusBadge tone={row.action === "create" ? "success" : row.action === "update" ? "warning" : "danger"}>{formatImportActionLabel(row.action)}</StatusBadge>}
                  />
                ) : null}
                {importResult.dryRun ? (
                  <div className="admin-summary-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={importApplyLoading || Boolean(importLoading) || Boolean(downloadLoading) || importResult?.errors?.length > 0 || !getImportPreviewSummary().okToApply}
                      onClick={openImportApplyConfirm}
                    >
                      {importApplyLoading ? "匯入中..." : "正式匯入商品"}
                    </button>
                  </div>
                ) : null}
              </section>
            ) : null}
            {importLoading && <div className="loading-state">正在進行匯入預覽，請稍候...</div>}
            {importApplyLoading && <div className="loading-state">正在套用匯入，請稍候...</div>}
            {batchMode ? (
              <div className="batch-action-bar">
                <StatusBadge tone="info">已選 {selectedProductIds.length} 筆</StatusBadge>
                <button type="button" className="secondary-button" onClick={clearBatchSelection}>
                  清除選取
                </button>
              </div>
            ) : null}
            <FilterBar>
              <label className="form-field">
                <span>關鍵字搜尋</span>
                <input type="text" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="輸入商品名稱或 SKU" />
              </label>
            </FilterBar>
            <div className="admin-filter-stack">
              <div>
                <div className="admin-filter-label">分類</div>
                <FilterChips items={categoryChipItems} value={categoryFilter} onChange={setCategoryFilter} />
              </div>
              <div>
                <div className="admin-filter-label">狀態</div>
                <FilterChips items={statusChipItems} value={statusFilter} onChange={setStatusFilter} />
              </div>
              <div>
                <div className="admin-filter-label">庫存狀態</div>
                <FilterChips items={stockChipItems} value={stockFilter} onChange={setStockFilter} />
              </div>
            </div>
            {loading ? <div className="loading-state">載入商品資料中...</div> : null}
            {error ? <div className="error-banner">{error}</div> : null}
            {!loading && !error ? (
              <DataTable
                columns={columns.filter(Boolean)}
                rows={filteredItems}
                emptyText="目前沒有符合條件的商品。"
                cardTitle={(row) => (
                  <div className="product-identity">
                    {batchMode ? (
                      <button
                        type="button"
                        className={`product-select-circle${selectedProductIds.includes(row.id) ? " product-select-circle-active" : ""}`}
                        onClick={() => toggleSelectedProduct(row.id)}
                        aria-label={`選取 ${row.name}`}
                      >
                        {selectedProductIds.includes(row.id) ? "✓" : ""}
                      </button>
                    ) : null}
                    <div className="identity-copy">
                      <div className="identity-title">{row.name}</div>
                      <div className="identity-subtitle">SKU：{row.sku} / {row.categoryLabel}</div>
                    </div>
                  </div>
                )}
                cardBadges={(row) => (
                  <>
                    <StatusBadge tone={row.stockTone}>{row.stockLabel}</StatusBadge>
                    <StatusBadge tone={row.isActive ? "success" : "neutral"}>{row.statusLabel}</StatusBadge>
                  </>
                )}
                cardFooter={(row) => (
                  <div className="compact-card-footer">
                    <div className="compact-card-meta">
                      <strong>{formatCurrency(row.price)}</strong>
                      <span>庫存 {row.stock}</span>
                    </div>
                    <button type="button" className="secondary-button compact-detail-button" onClick={() => setDetailProductId(row.id)}>
                      查看詳情
                    </button>
                  </div>
                )}
              />
            ) : null}
          </section>
        ) : null}
        {section === "CREATE" ? (
          <section className="admin-panel">
            <AdminSectionHeader
              eyebrow="新增商品"
              title={`Step ${productStep} / 5：${productSteps[productStep - 1]?.title}`}
              description="一次只填一組商品資料，完成後會開啟商品詳情供後續編輯。"
            />
            {productWizardProgress}
            <form className="admin-form-stack" onSubmit={handleSubmit}>
              {productStep === 1 ? (
              <div className="admin-subpanel wizard-panel wizard-panel-blue">
                <div className="section-title">商品名稱與分類</div>
                <div className="grid-form">
                  <label className="form-field">
                    <span>商品名稱</span>
                    <input name="name" type="text" value={form.name} onChange={handleChange} required />
                  </label>
                  <label className="form-field">
                    <span>分類</span>
                    <select name="category" value={getSelectedCategoryValue(form.categoryId, form.category)} onChange={handleProductCategoryChange}>
                      {categoryOptions.map(({ value, label }) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="sop-summary-box">
                  <div>
                    <strong>目前分類</strong>
                    <span>{categoryLookupByValue.get(getSelectedCategoryValue(form.categoryId, form.category))?.label || PRODUCT_CATEGORY_LABELS[form.category] || form.category || "-"}</span>
                  </div>
                  <div>
                    <strong>即將使用的 SKU</strong>
                    <span>{currentSkuPreview}</span>
                  </div>
                  <div>
                    <strong>格式</strong>
                    <span>區域-分類代碼-商品編號-貨架層</span>
                  </div>
                </div>
              </div>
              ) : null}
              {productStep === 2 ? (
              <div className="admin-subpanel wizard-panel wizard-panel-blue">
                <div className="section-title">SKU 與庫存</div>
                <div className="grid-form">
                  <label className="form-field">
                    <span>SKU</span>
                    <input name="sku" type="text" value={form.sku} onChange={handleChange} required />
                  </label>
                  <button type="button" className="secondary-button inline-submit" onClick={generateSku}>
                    重新產生 SKU
                  </button>
                  <label className="form-field">
                    <span>初始庫存</span>
                    <input name="stock" type="number" min="0" step="1" value={form.stock} onChange={handleChange} required />
                  </label>
                  <label className="form-field">
                    <span>補貨警戒值</span>
                    <input name="reorderLevel" type="number" min="0" step="1" value={form.reorderLevel} onChange={handleChange} />
                  </label>
                  <label className="form-field">
                    <span>庫位</span>
                    <input name="location" type="text" value={form.location} onChange={handleChange} />
                  </label>
                </div>
                <div className="sop-summary-box">
                  <div>
                    <strong>SKU 預覽</strong>
                    <span>{currentSkuPreview}</span>
                  </div>
                  <div>
                    <strong>分類代碼</strong>
                    <span>{form.category}</span>
                  </div>
                  <div>
                    <strong>說明</strong>
                    <span>分類變更後會重新抓取下一個可用 SKU。</span>
                  </div>
                </div>
              </div>
              ) : null}
              {productStep === 3 ? (
              <div className="admin-subpanel wizard-panel wizard-panel-blue">
                <div className="section-title">價格</div>
                <div className="grid-form">
                  <label className="form-field">
                    <span>售價</span>
                    <input name="price" type="number" min="0" step="0.01" value={form.price} onChange={handleChange} required />
                  </label>
                  <label className="form-field">
                    <span>成本</span>
                    <input name="costPrice" type="number" min="0" step="0.01" value={form.costPrice} onChange={handleChange} />
                  </label>
                </div>
              </div>
              ) : null}
              {productStep === 4 ? (
              <div className="admin-subpanel admin-image-manager wizard-panel wizard-panel-blue">
                <div className="section-title">商品圖片</div>
                <div className="grid-form">
                  <label className="form-field">
                    <span>圖片網址</span>
                    <input name="imageUrl" type="text" value={form.imageUrl} onChange={handleChange} placeholder="可貼上完整網址或既有商品圖片路徑" />
                  </label>
                  <label className="form-field">
                    <span>上傳圖片</span>
                    <input type="file" accept="image/*" onChange={handleImageFile} disabled={imageUploading} />
                  </label>
                </div>
                <div className="product-image-preview">
                  <ProductImage src={imagePreviewUrl || form.imageUrl} alt="商品預覽" className="product-image-preview-thumb" />
                  <div className="muted-text">{imageUploading ? "圖片上傳中..." : form.imageUrl ? "目前使用此圖片顯示預覽。" : "尚未設定圖片。可輸入網址或直接上傳。"}</div>
                </div>
              </div>
              ) : null}
              {productStep === 5 ? (
              <div className="admin-subpanel wizard-panel wizard-panel-green">
                <div className="section-title">確認</div>
                <div className="sop-summary-box">
                  <div><strong>商品</strong><span>{form.name || "-"}</span></div>
                  <div><strong>分類</strong><span>{categoryLookupByValue.get(getSelectedCategoryValue(form.categoryId, form.category))?.label || PRODUCT_CATEGORY_LABELS[form.category] || form.category || "-"}</span></div>
                  <div><strong>SKU</strong><span>{currentSkuPreview}</span></div>
                  <div><strong>庫存</strong><span>{form.stock || "0"}</span></div>
                  <div><strong>售價</strong><span>{formatCurrency(form.price)}</span></div>
                  <div><strong>圖片</strong><span>{form.imageUrl ? "已設定" : "未設定"}</span></div>
                </div>
                <label className="form-field form-field-wide">
                  <span>商品說明</span>
                  <textarea name="description" value={form.description} onChange={handleChange} rows="3" />
                </label>
              </div>
              ) : null}
              <div className="admin-form-actions">
                <div className="wizard-actions">
                  {productStep > 1 ? (
                    <button type="button" className="secondary-button" onClick={() => setProductStep((current) => Math.max(1, current - 1))}>
                      上一步
                    </button>
                  ) : null}
                  {productStep < 5 ? (
                    <button type="button" className="primary-button" onClick={() => goToProductStep(productStep + 1)} disabled={(productStep === 1 && (!form.name.trim() || !form.category)) || (productStep === 2 && (!form.sku.trim() || form.stock === "")) || (productStep === 3 && form.price === "")}>
                      下一步
                    </button>
                  ) : (
                    <button type="submit" className="primary-button" disabled={submitting || imageUploading}>
                      {submitting ? "儲存中..." : "儲存商品"}
                    </button>
                  )}
                </div>
              </div>
            </form>
          </section>
        ) : null}
        {section === "CATEGORY" ? (
          <section className="admin-panel">
            <AdminSectionHeader eyebrow="分類管理" title="門市商品分類" description="分類依目前門市分開管理，停用後保留既有商品歷史資料。" />
            <form className="admin-subpanel grid-form" onSubmit={saveCategory}>
              <label className="form-field">
                <span>分類代碼</span>
                <input value={categoryForm.code} onChange={(event) => setCategoryForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))} required />
              </label>
              <label className="form-field">
                <span>分類名稱</span>
                <input value={categoryForm.name} onChange={(event) => setCategoryForm((current) => ({ ...current, name: event.target.value }))} required />
              </label>
              <label className="form-field">
                <span>排序</span>
                <input type="number" step="1" value={categoryForm.sortOrder} onChange={(event) => setCategoryForm((current) => ({ ...current, sortOrder: event.target.value }))} />
              </label>
              <div className="admin-form-actions">
                <button type="submit" className="primary-button inline-submit" disabled={categorySaving}>
                  {categorySaving ? "儲存中..." : categoryForm.id ? "儲存分類" : "新增分類"}
                </button>
                {categoryForm.id ? (
                  <button type="button" className="secondary-button" onClick={() => setCategoryForm({ id: null, code: "", name: "", sortOrder: "0" })}>
                    取消編輯
                  </button>
                ) : null}
              </div>
            </form>
            {categories.loading ? <div className="loading-state">載入分類資料中...</div> : null}
            {categories.error ? <div className="error-banner">{categories.error}</div> : null}
            <div className="admin-summary-grid">
              {(categories.items.length ? categories.items : categoryOptions).map((category) => (
                <article key={category.id || category.code} className="admin-summary-card">
                  <div className="admin-summary-label">{category.name || category.label}</div>
                  <div className="admin-summary-value">{category.productCount ?? productRows.filter((item) => item.category === category.code).length}</div>
                  <div className="muted-text">代碼：{category.code} / {category.isActive === false ? "已停用" : "啟用中"}</div>
                  {category.id ? (
                    <div className="admin-form-actions">
                      <button type="button" className="secondary-button" onClick={() => editCategory(category)} disabled={categorySaving}>
                        編輯
                      </button>
                      <button type="button" className="secondary-button" onClick={() => deactivateCategory(category)} disabled={categorySaving || category.isActive === false}>
                        {category.isActive === false ? "已停用" : "停用"}
                      </button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}
        {section === "SKU" ? (
          <section className="admin-panel">
            <AdminSectionHeader
              eyebrow="SKU / 規則"
              title="SKU 規則摘要"
              description="延續既有分類規則產生 SKU，集中顯示草稿、規則與使用情況。"
              actions={
                <button type="button" className="secondary-button" onClick={generateSku}>
                  依目前分類產生 SKU
                </button>
              }
            />
            <div className="admin-summary-grid">
              <article className="admin-summary-card">
                <div className="admin-summary-label">目前分類</div>
                <div className="admin-summary-value admin-summary-value-small">{categoryLookupByValue.get(getSelectedCategoryValue(form.categoryId, form.category))?.label || PRODUCT_CATEGORY_LABELS[form.category] || form.category || "-"}</div>
              </article>
              <article className="admin-summary-card">
                <div className="admin-summary-label">草稿 SKU</div>
                <div className="admin-summary-value admin-summary-value-small">{form.sku || "尚未產生"}</div>
              </article>
              <article className="admin-summary-card">
                <div className="admin-summary-label">已使用 SKU</div>
                <div className="admin-summary-value">{productRows.filter((item) => item.sku).length}</div>
              </article>
            </div>
          </section>
        ) : null}
        {section === "IMAGES" ? (
          <section className="admin-panel">
            <AdminSectionHeader eyebrow="圖片管理" title="商品圖片預覽" description="集中處理圖片網址與上傳預覽，沿用既有 WordPress / NAS 圖片策略。" />
            <div className="admin-image-manager">
              <div className="grid-form">
                <label className="form-field">
                  <span>圖片網址</span>
                  <input name="imageUrl" type="text" value={form.imageUrl} onChange={handleChange} />
                </label>
                <label className="form-field">
                  <span>上傳圖片</span>
                  <input type="file" accept="image/*" onChange={handleImageFile} disabled={imageUploading} />
                </label>
              </div>
              <div className="product-image-preview">
                <ProductImage src={imagePreviewUrl || form.imageUrl} alt="商品預覽" className="product-image-preview-thumb" />
                <div className="muted-text">
                  {imageUploading ? "圖片上傳中..." : form.imageUrl ? "目前預覽使用現有圖片來源。" : "目前沒有圖片預覽，請輸入圖片網址或上傳圖片。"}
                </div>
              </div>
            </div>
          </section>
        ) : null}
        {section === "STOCK" ? (
          <section className="admin-panel">
            <AdminSectionHeader eyebrow="庫存調整" title="商品內快速調整" description="保留現有商品頁直接調整庫存流程，但整理成一致卡片與操作區塊。" />
            <FilterBar compact>
              <label className="form-field">
                <span>搜尋商品</span>
                <input type="text" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="輸入商品名稱或 SKU" />
              </label>
            </FilterBar>
            <div className="stock-editor-list">
              {filteredItems.map((item) => {
                const draftValue = stockDrafts[String(item.id)] ?? String(item.stock ?? 0);
                return (
                  <div key={item.id} className="stock-editor-card">
                    <div className="stock-editor-main">
                      <div className="stock-editor-title-row">
                        <div className="stock-editor-title">{item.name}</div>
                        <StatusBadge tone={item.stockTone}>{item.stockLabel}</StatusBadge>
                      </div>
                      <div className="muted-text">SKU：{item.sku} / 分類：{item.categoryLabel || getCategoryLabel(item.category)} / 目前庫存：{item.stock}</div>
                    </div>
                    <div className="stock-editor-controls">
                      <label className="form-field stock-editor-input">
                        <span>調整後庫存</span>
                        <input type="number" min="0" step="1" inputMode="numeric" value={draftValue} onChange={(event) => handleStockDraftChange(String(item.id), event.target.value)} />
                      </label>
                      <button type="button" className="primary-button stock-save-button" onClick={() => saveStock(item)} disabled={stockSavingId === item.id}>
                        {stockSavingId === item.id ? "儲存中..." : "儲存庫存"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {!filteredItems.length ? <div className="empty-state">找不到符合條件的商品。</div> : null}
          </section>
        ) : null}
      </div>

      <DetailModal
        open={Boolean(detailProduct)}
        title={detailProduct?.name || "商品詳情"}
        subtitle={detailProduct ? `${detailProduct.categoryLabel} / SKU：${detailProduct.sku}` : ""}
        onClose={() => setDetailProductId(null)}
      >
        {detailProduct ? (
          <div className="admin-detail-layout">
            <section className="product-detail-hero">
              <div className="admin-detail-media">
                <div className="admin-detail-image-fixed" style={{ width: 160, height: 160, overflow: "hidden" }}>
                  {detailProduct.imageUrl ? (
                    <ProductImage src={detailProduct.imageUrl} alt={detailProduct.name} className="admin-detail-image" />
                  ) : (
                    <div className="admin-detail-image-empty">無圖</div>
                  )}
                </div>
              </div>
              <div className="product-detail-copy">
                <div className="product-detail-title">{detailProduct.name}</div>
                <div className="muted-text">
                  {detailProduct.sku} / {detailProduct.categoryLabel} / {detailProduct.statusLabel}
                </div>
                <div className="muted-text">處理人員：{detailProduct.inputterName || "-"}</div>
                <div className="admin-summary-grid product-detail-summary-grid">
                  <article className="admin-summary-card">
                    <div className="admin-summary-label">價格</div>
                    <div className="admin-summary-value admin-summary-value-small">{formatCurrency(detailProduct.price)}</div>
                  </article>
                  <article className="admin-summary-card">
                    <div className="admin-summary-label">庫存</div>
                    <div className="admin-summary-value admin-summary-value-small">{detailProduct.stock}</div>
                  </article>
                  <article className="admin-summary-card">
                    <div className="admin-summary-label">SKU</div>
                    <div className="admin-summary-value admin-summary-value-small">{detailProduct.sku}</div>
                  </article>
                  <article className="admin-summary-card">
                    <div className="admin-summary-label">類別</div>
                    <div className="admin-summary-value admin-summary-value-small">{detailProduct.categoryLabel}</div>
                  </article>
                  <article className="admin-summary-card">
                    <div className="admin-summary-label">狀態</div>
                    <div className="admin-summary-value admin-summary-value-small">
                      <StatusBadge tone={detailProduct.isActive ? "success" : "neutral"}>{detailProduct.statusLabel}</StatusBadge>
                    </div>
                  </article>
                </div>
              </div>
            </section>
            <section className="stack-card">
              <div className="section-title">編輯商品</div>
              <form className="grid-form compact-grid" onSubmit={saveProductDetail}>
                <label className="form-field">
                  <span>商品名稱</span>
                  <input value={detailForm.name} onChange={(event) => setDetailForm((current) => ({ ...current, name: event.target.value }))} required />
                </label>
                <label className="form-field">
                  <span>SKU</span>
                  <input value={detailForm.sku} onChange={(event) => setDetailForm((current) => ({ ...current, sku: event.target.value }))} required />
                </label>
                <label className="form-field">
                  <span>分類</span>
                  <select value={getSelectedCategoryValue(detailForm.categoryId, detailForm.category)} onChange={handleDetailProductCategoryChange}>
                    {categoryOptions.map(({ value, label }) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>售價</span>
                  <input type="number" min="0" step="0.01" value={detailForm.price} onChange={(event) => setDetailForm((current) => ({ ...current, price: event.target.value }))} required />
                </label>
                <label className="form-field">
                  <span>補貨警戒值</span>
                  <input type="number" min="0" step="1" value={detailForm.reorderLevel} onChange={(event) => setDetailForm((current) => ({ ...current, reorderLevel: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>庫位</span>
                  <input value={detailForm.location} onChange={(event) => setDetailForm((current) => ({ ...current, location: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>成本</span>
                  <input type="number" min="0" step="0.01" value={detailForm.costPrice} onChange={(event) => setDetailForm((current) => ({ ...current, costPrice: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>圖片網址</span>
                  <input
                    type="text"
                    value={detailForm.imageUrl}
                    onChange={(event) => {
                      setDetailImagePreviewUrl((current) => {
                        revokePreviewUrl(current);
                        return "";
                      });
                      setDetailForm((current) => ({ ...current, imageUrl: event.target.value }));
                    }}
                  />
                </label>
                <label className="form-field">
                  <span>上傳圖片</span>
                  <input type="file" accept="image/*" onChange={handleDetailImageFile} disabled={detailImageUploading} />
                </label>
                <label className="form-field">
                  <span>上架狀態</span>
                  <select value={detailForm.isActive ? "1" : "0"} onChange={(event) => setDetailForm((current) => ({ ...current, isActive: event.target.value === "1" }))}>
                    <option value="1">上架中</option>
                    <option value="0">未上架</option>
                  </select>
                </label>
                <label className="form-field form-field-wide">
                  <span>商品說明</span>
                  <textarea value={detailForm.description} onChange={(event) => setDetailForm((current) => ({ ...current, description: event.target.value }))} rows="3" />
                </label>
                <button type="submit" className="primary-button inline-submit" disabled={detailImageUploading}>
                  {detailImageUploading ? "圖片上傳中..." : "儲存商品"}
                </button>
              </form>
              <div className="product-image-preview">
                <ProductImage
                  src={detailImagePreviewUrl || buildProductPreviewUrl(detailForm.imageUrl, detailProduct.id) || detailProduct.imageUrl}
                  alt="商品圖片預覽"
                  className="product-image-preview-thumb"
                />
                <div className="muted-text">
                  {detailImageUploading ? "圖片上傳中..." : detailForm.imageUrl ? "儲存後會套用此圖片。" : "目前沒有圖片。"}
                </div>
              </div>
            </section>

            <div className="admin-split-grid">
              <section className="stack-card">
                <div className="section-title">價格與庫存</div>
                <div className="field-grid">
                  <div className="field-item">
                    <div className="field-label">成本</div>
                    <div className="field-value">{formatCurrency(detailProduct.costPrice)}</div>
                  </div>
                  <div className="field-item">
                    <div className="field-label">補貨警戒值</div>
                    <div className="field-value">{detailProduct.reorderLevel ?? 0}</div>
                  </div>
                  <div className="field-item">
                    <div className="field-label">庫位</div>
                    <div className="field-value">{detailProduct.location || "-"}</div>
                  </div>
                  <div className="field-item">
                    <div className="field-label">品牌 / 標籤</div>
                    <div className="field-value">{detailProduct.brand || detailProduct.tags || "-"}</div>
                  </div>
                </div>
              </section>
              <section className="stack-card">
                <div className="section-title">商品說明</div>
                <div className="field-item field-item-full">
                  <div className="field-value">{detailProduct.description || "目前沒有商品說明。"}</div>
                </div>
              </section>
            </div>
          </div>
        ) : null}
      </DetailModal>
      <ActionModal
        open={Boolean(importApplyConfirm)}
        tone="danger"
        title="確認套用匯入"
        cancelText="取消"
        confirmText="正式匯入商品"
        message={`確定要正式匯入商品嗎？此動作會變更目前門市商品資料。\n新增 ${importApplyConfirm?.createCount || 0} 筆，更新 ${importApplyConfirm?.updateCount || 0} 筆，共 ${importApplyConfirm?.totalRows || 0} 列。`}
        onConfirm={executeApplyImport}
        onCancel={() => setImportApplyConfirm(null)}
      />
      <ActionModal
        open={Boolean(warningModal)}
        tone="warning"
        title={warningModal?.title}
        message={warningModal?.message}
        onConfirm={() => setWarningModal(null)}
      />
    </div>
  );
}

export default ProductsPage;
