// P2-3911: OpenAPI models of the SP access routes.
import { ApiProperty } from '@nestjs/swagger';

export class SpProgramModel {
  @ApiProperty({ type: Number, example: 1, description: 'CLARISA id' })
  id!: number;

  @ApiProperty({ type: String, example: 'SP01' })
  code!: string;

  @ApiProperty({ type: String, example: 'Breeding for Tomorrow' })
  name!: string;
}

export class SpUserModel {
  @ApiProperty({ type: String, example: 'First Last' })
  name!: string;
}

export class IssuedSpCodeModel {
  @ApiProperty({
    type: String,
    description: 'Opaque one-time code (43 base64url characters); works once',
  })
  code!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: '60 s after issue',
  })
  expiresAt!: string;
}

export class SpSessionModel {
  @ApiProperty({
    type: String,
    description:
      'Opaque SP session token. Send it as `Authorization: Bearer` on the /sp routes only; keep it in memory',
  })
  accessToken!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: '8 h after the exchange',
  })
  expiresAt!: string;

  @ApiProperty({ type: SpUserModel })
  user!: SpUserModel;

  @ApiProperty({
    type: SpProgramModel,
    nullable: true,
    description: "The code's program; null for an admin who sent none",
  })
  program!: SpProgramModel | null;

  @ApiProperty({ type: Boolean })
  isReportingAdmin!: boolean;
}

export class SpMeModel {
  @ApiProperty({ type: SpUserModel })
  user!: SpUserModel;

  @ApiProperty({ type: Boolean })
  isReportingAdmin!: boolean;

  @ApiProperty({
    type: SpProgramModel,
    nullable: true,
    description: "The session's program; null for an admin who sent none",
  })
  program!: SpProgramModel | null;

  @ApiProperty({
    type: [SpProgramModel],
    description:
      'The programs this session may open: every Science Program for an admin, else just its own',
  })
  programs!: SpProgramModel[];
}
