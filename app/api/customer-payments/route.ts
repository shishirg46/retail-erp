import { NextRequest, NextResponse } from "next/server";

import { requireRole, CASHIER, OWNER } from "@/lib/auth/authorize";
import { prisma } from "@/lib/prisma";
import { toHttpResponse } from "@/lib/response";
import { CustomerPaymentService } from "@/modules/customer-payments/customer-payment.service";
import { toCreditPaymentApi } from "@/modules/customer-payments/customer-payment.repository";
import { validateCreateCustomerPaymentInput } from "@/modules/customer-payments/customer-payment.validation";

export async function POST(req: NextRequest) {
  try {
    await requireRole(req, [OWNER, CASHIER]);
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
    }

    const input = validateCreateCustomerPaymentInput(body);

    const payment = await new CustomerPaymentService(prisma).createCustomerPayment(
      input
    );

    return NextResponse.json(toCreditPaymentApi(payment), { status: 201 });
  } catch (error) {
    return toHttpResponse(error);
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, [OWNER, CASHIER]);
    const payments = await new CustomerPaymentService(prisma).listCustomerPayments();

    return NextResponse.json(payments.map(toCreditPaymentApi));
  } catch (error) {
    return toHttpResponse(error);
  }
}