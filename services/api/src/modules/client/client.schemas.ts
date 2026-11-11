import { z } from "zod";

import { searchPagingShape } from "../../utils/search-schemas.js";

export const marketplaceSearchQuerySchema = z.looseObject({
  ...searchPagingShape,
});
