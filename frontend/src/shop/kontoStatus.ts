import type { OrderStatus } from './api/types'

type BadgeVariante = 'default' | 'success' | 'warning' | 'destructive' | 'info'

export const ORDER_STATUS_KEY: Record<OrderStatus, string> = {
  draft: 'shop.konto.status.draft',
  pending_payment: 'shop.konto.status.pendingPayment',
  paid: 'shop.konto.status.paid',
  fulfilled: 'shop.konto.status.fulfilled',
  failed: 'shop.konto.status.failed',
  cancelled: 'shop.konto.status.cancelled',
  refunded: 'shop.konto.status.refunded',
}

export const ORDER_STATUS_VARIANT: Record<OrderStatus, BadgeVariante> = {
  draft: 'default',
  pending_payment: 'warning',
  paid: 'info',
  fulfilled: 'success',
  failed: 'destructive',
  cancelled: 'default',
  refunded: 'warning',
}
