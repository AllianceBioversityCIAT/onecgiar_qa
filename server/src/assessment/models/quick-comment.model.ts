// @akili-spec assessment/step-1-assessment
import { ApiProperty } from '@nestjs/swagger';

/** The OpenAPI model of a quick comment (design 6, FR-12): what `QuickCommentView` carries. */
export class QuickCommentModel {
  @ApiProperty({ type: Number, example: 12 })
  id!: number;

  @ApiProperty({ type: String, example: 'Please add the evidence link' })
  body!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}
