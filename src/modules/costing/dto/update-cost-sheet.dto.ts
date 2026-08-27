import { PartialType } from '@nestjs/swagger';
import { CreateCostSheetDto } from './create-cost-sheet.dto';

/**
 * Edits the sheet in place. Use this to correct a mistake in the CURRENT
 * version; to record a genuine cost change, create a new version instead so the
 * old margins stay answerable.
 */
export class UpdateCostSheetDto extends PartialType(CreateCostSheetDto) {}
