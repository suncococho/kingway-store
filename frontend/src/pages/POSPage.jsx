import { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader";
import { apiRequest } from "../lib/api";

function POSPage() {
  const [products, setProducts] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [cart, setCart] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState("CASH");

  useEffect(() => {
    async function loadProducts() {
      try {
        const data = await apiRequest("/api/products");
        setProducts(data);
      } catch (error) {
        alert(error.message);
      }
    }

    loadProducts();
  }, []);

  function addToCart() {
    const product = products.find((item) => String(item.id) === String(selectedProductId));
    if (!product) {
      return;
    }

    setCart((current) => {
      const existing = current.find((item) => item.id === product.id);
      if (existing) {
        return current.map((item) =>
          item.id === product.id ? { ...item, qty: item.qty + Number(quantity) } : item
        );
      }

      return [...current, { ...product, qty: Number(quantity) }];
    });
  }

  function removeFromCart(productId) {
    setCart((current) => current.filter((item) => item.id !== productId));
  }

  async function submitOrder() {
    if (!cart.length) {
      return;
    }

    try {
      await apiRequest("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          customer_name: customerName,
          customer_phone: customerPhone,
          paymentMethod,
          items: cart.map((item) => ({
            product_id: item.id,
            qty: item.qty
          }))
        })
      });

      setCart([]);
      setCustomerName("");
      setCustomerPhone("");
      alert("Order created successfully");
    } catch (error) {
      alert(error.message);
    }
  }

  const totalPrice = cart.reduce((sum, item) => sum + Number(item.price) * Number(item.qty), 0);

  return (
    <div>
      <PageHeader title="POS" description="Create in-store orders and deduct stock automatically." />
      <section className="content-card form-card">
        <h2>Create POS Order</h2>
        <div className="grid-form compact-grid">
          <label className="form-field">
            <span>Product</span>
            <select value={selectedProductId} onChange={(event) => setSelectedProductId(event.target.value)}>
              <option value="">Select product</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} ({product.sku}) stock={product.stock}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Quantity</span>
            <input
              type="number"
              min="1"
              value={quantity}
              onChange={(event) => setQuantity(Number(event.target.value))}
            />
          </label>
          <button type="button" className="primary-button inline-submit" onClick={addToCart}>
            Add to Cart
          </button>
        </div>

        <div className="grid-form compact-grid">
          <label className="form-field">
            <span>Customer Name</span>
            <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
          </label>
          <label className="form-field">
            <span>Customer Phone</span>
            <input value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} />
          </label>
          <label className="form-field">
            <span>Payment Method</span>
            <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
              <option value="CASH">CASH</option>
              <option value="CARD">CARD</option>
              <option value="LINE_PAY">LINE_PAY</option>
              <option value="TRANSFER">TRANSFER</option>
              <option value="OTHER">OTHER</option>
            </select>
          </label>
        </div>
      </section>
      <section className="content-card">
        <h2>Cart</h2>
        {cart.length === 0 ? <div className="empty-state">No items in cart.</div> : null}
        {cart.length > 0 ? (
          <div className="cart-list">
            {cart.map((item) => (
              <div key={item.id} className="cart-row">
                <div>
                  {item.name} / {item.sku}
                </div>
                <div>
                  {item.qty} x NT${item.price}
                </div>
                <button type="button" className="secondary-button" onClick={() => removeFromCart(item.id)}>
                  Remove
                </button>
              </div>
            ))}
            <div className="cart-total">Total: NT${totalPrice.toFixed(2)}</div>
            <button type="button" className="primary-button wide-button" onClick={submitOrder}>
              Create Order
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export default POSPage;
