import {
  NAME_MAX_LENGTH,
  NICKNAME_MAX_LENGTH,
} from '../users-admin.service.js';
import { TextProp } from './user-fields.js';

/** `PATCH /users/:id` (FR-5). The email never changes: sending it is a 400. */
export class EditUserDto {
  @TextProp(
    NICKNAME_MAX_LENGTH,
    { description: 'Unique, whatever the case', example: 'Ada' },
    { optional: true },
  )
  nickname?: string;

  @TextProp(
    NAME_MAX_LENGTH,
    {
      description:
        'Only while the user has never signed in (else `USERS_NAME_LOCKED`)',
      example: 'Ada',
    },
    { optional: true },
  )
  firstName?: string;

  @TextProp(
    NAME_MAX_LENGTH,
    {
      description:
        'Only while the user has never signed in (else `USERS_NAME_LOCKED`)',
      example: 'Lovelace',
    },
    { optional: true },
  )
  lastName?: string;
}
