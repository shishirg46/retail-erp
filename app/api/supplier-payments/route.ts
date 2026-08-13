import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { toHttpResponse } from "@/lib/response";
import { SupplierPaymentService } from "@/modules/supplier-payments/supplier-payment.service";
import { validateCreateSupplierPaymentInput } from "@/modules/supplier-payments/supplier-payment.validation";

export async function POST(req: NextRequest) {
  try {
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

    return NextResponse.json(payment, { status: 201 });
  } catch (error) {
    return toHttpResponse(error);
  }
}

export async function GET() {
  try {
    const payments = await new SupplierPaymentService(prisma).listSupplierPayments();

    return NextResponse.json(payments);
  } catch (error) {
    return toHttpResponse(error);
  }
}