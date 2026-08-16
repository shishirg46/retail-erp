import { beforeEach, describe, expect, it } from "vitest";

import { useCart } from "@/stores/cart";

const RICE = { productId: "rice-1", name: "Rice", unit: "pcs", pricePerUnit: 70 };
const OIL = { productId: "oil-1", name: "Oil", unit: "L", pricePerUnit: 180 };

describe("cart store", () => {
  beforeEach(() => {
    useCart.setState({
      items: [],
      paymentType: "CASH",
      customerId: null,
    });
  });

  it("adds a new line with qty 1", () => {
    useCart.getState().addItem(RICE);
    expect(useCart.getState().items).toEqual([{ ...RICE, qty: 1 }]);
  });

  it("increments qty when the same product is added again", () => {
    const { addItem } = useCart.getState();
    addItem(RICE);
    addItem(RICE);
    const line = useCart.getState().items.find((item) => item.productId === RICE.productId);
    expect(line?.qty).toBe(2);
    expect(useCart.getState().items).toHaveLength(1);
  });

  it("setQuantity removes the line at zero or below", () => {
    const { addItem, setQuantity } = useCart.getState();
    addItem(RICE);
    setQuantity(RICE.productId, 0);
    expect(useCart.getState().items).toHaveLength(0);
  });

  it("setQuantity updates an existing line", () => {
    const { addItem, setQuantity } = useCart.getState();
    addItem(RICE);
    setQuantity(RICE.productId, 5);
    expect(useCart.getState().items[0]?.qty).toBe(5);
  });

  it("removeItem drops only the named product", () => {
    const { addItem, removeItem } = useCart.getState();
    addItem(RICE);
    addItem(OIL);
    removeItem(RICE.productId);
    expect(useCart.getState().items.map((line) => line.productId)).toEqual(["oil-1"]);
  });

  it("reset clears lines and payment type and keeps the CREDIT customer (plan §12.1)", () => {
    const { addItem, setCustomerId, setPaymentType, reset } = useCart.getState();
    addItem(RICE);
    setPaymentType("CREDIT");
    setCustomerId("customer-9");
    reset();

    const state = useCart.getState();
    expect(state.items).toEqual([]);
    expect(state.paymentType).toBe("CASH");
    expect(state.customerId).toBe("customer-9");
  });

  it("reset drops the customer for CASH/ECASH", () => {
    const { setCustomerId, setPaymentType, reset } = useCart.getState();
    setPaymentType("CASH");
    setCustomerId("customer-9");
    reset();
    expect(useCart.getState().customerId).toBeNull();
  });
});
