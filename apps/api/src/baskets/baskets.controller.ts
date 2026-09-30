import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { optimiseBasket, optimiseBody, saveBasketBody, type OfferPrice } from '@qarib/shared';
import { AuthedRequest, AuthGuard } from '../auth/auth.guard';
import { ApiZodBody, ZodPipe } from '../common/zod';
import { Db } from '../db/db.service';

@ApiTags('baskets')
@Controller('baskets')
export class BasketsController {
  constructor(private readonly db: Db) {}

  /** Anonymous: nothing is stored. Uses each retailer's cheapest current offer per product. */
  @Post('optimise')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cheapest store (and best two-store split) for a list of products.' })
  @ApiZodBody(optimiseBody)
  async optimise(@Body(new ZodPipe(optimiseBody)) body: ReturnType<typeof optimiseBody.parse>) {
    const ids = [...new Set(body.items.map((i) => i.product_id))];
    const offers = await this.db.query<{
      product_id: string;
      retailer_id: string;
      retailer_slug: string;
      retailer_name_en: string;
      price_qar: string;
    }>(
      `select product_id, retailer_id, retailer_slug, retailer_name_en, min(price_qar) as price_qar
         from public_offers where product_id = any($1::uuid[]) and in_stock
        group by product_id, retailer_id, retailer_slug, retailer_name_en`,
      [ids],
    );
    const prices: OfferPrice[] = offers.map((o) => ({ ...o, price_qar: Number(o.price_qar) }));
    return optimiseBasket(body.items, prices, body);
  }

  @Get()
  @UseGuards(AuthGuard)
  async list(@Req() req: AuthedRequest) {
    const rows = await this.db.query(
      `select b.id, b.name, b.created_at, b.updated_at,
              coalesce(json_agg(json_build_object('product_id', i.product_id, 'quantity', i.quantity))
                       filter (where i.id is not null), '[]') as items
         from baskets b left join basket_items i on i.basket_id = b.id
        where b.user_id = $1 group by b.id order by b.updated_at desc`,
      [req.user!.id],
    );
    return { baskets: rows };
  }

  @Post()
  @UseGuards(AuthGuard)
  @ApiZodBody(saveBasketBody)
  async create(
    @Req() req: AuthedRequest,
    @Body(new ZodPipe(saveBasketBody)) body: ReturnType<typeof saveBasketBody.parse>,
  ) {
    return this.db.tx(async (c) => {
      const b = await c.query<{ id: string }>(
        'insert into baskets (user_id, name) values ($1, $2) returning id',
        [req.user!.id, body.name],
      );
      await this.writeItems(c, b.rows[0]!.id, body.items);
      return { id: b.rows[0]!.id };
    });
  }

  @Put(':id')
  @UseGuards(AuthGuard)
  @ApiZodBody(saveBasketBody)
  async update(
    @Req() req: AuthedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(saveBasketBody)) body: ReturnType<typeof saveBasketBody.parse>,
  ) {
    await this.db.tx(async (c) => {
      const r = await c.query(
        'update baskets set name = $3 where id = $1 and user_id = $2 returning id',
        [id, req.user!.id, body.name],
      );
      if (!r.rowCount) throw new NotFoundException('Basket not found');
      await c.query('delete from basket_items where basket_id = $1', [id]);
      await this.writeItems(c, id, body.items);
    });
    return { id };
  }

  @Delete(':id')
  @UseGuards(AuthGuard)
  @HttpCode(204)
  async remove(@Req() req: AuthedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    const r = await this.db.query(
      'delete from baskets where id = $1 and user_id = $2 returning id',
      [id, req.user!.id],
    );
    if (!r.length) throw new NotFoundException('Basket not found');
  }

  private async writeItems(
    c: { query: (sql: string, p: unknown[]) => Promise<unknown> },
    basketId: string,
    items: { product_id: string; quantity: number }[],
  ) {
    const merged = new Map<string, number>();
    for (const i of items) merged.set(i.product_id, (merged.get(i.product_id) ?? 0) + i.quantity);
    for (const [pid, qty] of merged) {
      await c.query(
        'insert into basket_items (basket_id, product_id, quantity) values ($1, $2, $3)',
        [basketId, pid, Math.min(qty, 999)],
      );
    }
  }
}
