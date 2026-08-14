import { NextRequest, NextResponse } from "next/server";

import { requireRole, OWNER } from "@/lib/auth/authorize";
import { prisma } from "@/lib/prisma";
import { toHttpResponse } from "@/lib/response";
import { SupplierPaymentService } from "@/modules/supplier-payments/supplier-payment.service";
import { toSupplierPaymentApi } from "@/modules/supplier-payments/supplier-payment.repository";
import { validateCreateSupplierPaymentInput } from "@/modules/supplier-payments/supplier-payment.validation";

export async function POST(req: NextRequest) {
  try {
    await requireRole(req, [OWNER]);
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
    }

    const input = validateCreateSupplierPaymentInput(body);

    const payment = await new SupplierPaymentService(
      prisma
    ).createSupplierPayment(input);

    return NextResponse.json(toSupplierPaymentApi(payment), { status: 201 });
  } catch (error) {
    return toHttpResponse(error);
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, [OWNER]);
    const payments = await new SupplierPaymentService(prisma).listSupplierPayments();

    return NextResponse.json(payments.map(toSupplierPaymentApi));
  } catch (error) {
    return toHttpResponse(error);
  }
}