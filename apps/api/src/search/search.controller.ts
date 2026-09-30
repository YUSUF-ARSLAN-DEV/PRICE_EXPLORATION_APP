import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { autocompleteQuery, searchQuery } from '@qarib/shared';
import { AuthedRequest, OptionalAuthGuard } from '../auth/auth.guard';
import { ApiZodQuery, ZodPipe } from '../common/zod';
import { Db } from '../db/db.service';
import { SearchService } from './search.service';

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly db: Db,
  ) {}

  @Get()
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({
    summary: 'Search products and compare prices across grocers (no account needed).',
  })
  @ApiZodQuery(searchQuery)
  async run(
    @Req() req: AuthedRequest,
    @Query(new ZodPipe(searchQuery)) q: ReturnType<typeof searchQuery.parse>,
  ) {
    const res = await this.search.search(q);
    // Opt-in history: only when signed in AND the latest 'history' consent is granted.
    if (req.user && q.offset === 0) {
      const consent = await this.db.one<{ granted: boolean }>(
        `select granted from consents where user_id = $1 and purpose = 'history' order by created_at desc, id desc limit 1`,
        [req.user.id],
      );
      if (consent?.granted) {
        await this.db.query('insert into search_history (user_id, query) values ($1, $2)', [
          req.user.id,
          q.q.slice(0, 100),
        ]);
      }
    }
    return res;
  }

  @Get('autocomplete')
  @ApiZodQuery(autocompleteQuery)
  async autocomplete(
    @Query(new ZodPipe(autocompleteQuery)) q: ReturnType<typeof autocompleteQuery.parse>,
  ) {
    return { suggestions: await this.search.autocomplete(q.q, q.limit) };
  }

  @Get('popular')
  @ApiOperation({ summary: 'Popular searches (anonymous, k>=20).' })
  async popular() {
    return { popular: await this.search.popular() };
  }
}
