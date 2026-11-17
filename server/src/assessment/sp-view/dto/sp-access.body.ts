// P2-3911: request bodies of the SP access routes (contract § 2).
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** `POST /sp-access/codes`: who the Reporting back vouches for. */
export class IssueSpCodeBody {
  @ApiProperty({
    type: String,
    maxLength: 320,
    example: 'sp-user@example.org',
    description:
      'The Reporting user. Stored with each SP response (AC12); never logged',
  })
  @Transform(trimmed)
  @IsString()
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({
    type: String,
    minLength: 1,
    maxLength: 200,
    example: 'First Last',
    description: 'Full name, 1 to 200 characters after trim',
  })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    maxLength: 32,
    example: 'SP01',
    description:
      'Official code of the Science Program. Required when `isReportingAdmin` is false; an admin may send null (they pick a program in the view) or a code (the view opens on it)',
  })
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(32)
  programCode!: string | null;

  @ApiProperty({
    type: Boolean,
    description: 'True: the session may read and respond for ANY program',
  })
  @IsBoolean()
  isReportingAdmin!: boolean;
}

/** `POST /sp-access/session`: the one-time code from the iframe URL. */
export class ExchangeSpCodeBody {
  @ApiProperty({
    type: String,
    maxLength: 128,
    description: 'The code `POST /sp-access/codes` issued (works once, 60 s)',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  code!: string;
}
