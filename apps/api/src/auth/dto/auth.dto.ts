import { IsEmail, IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

export const PASSWORD_POLICY_MESSAGE =
  'Password must be at least 10 characters and include an upper-case letter, a lower-case letter and a number.';

export class LoginDto {
  @IsEmail({}, { message: 'Please enter a valid email address.' })
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'Please enter your password.' })
  password!: string;
}

export class RefreshDto {
  @IsString()
  @IsNotEmpty({ message: 'A refresh token is required.' })
  refreshToken!: string;
}

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'Please enter a valid email address.' })
  @IsNotEmpty()
  email!: string;
}

export class SetPasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'This link is not complete — token missing.' })
  token!: string;

  @IsString()
  @MinLength(10, { message: PASSWORD_POLICY_MESSAGE })
  @Matches(/[A-Z]/, { message: PASSWORD_POLICY_MESSAGE })
  @Matches(/[a-z]/, { message: PASSWORD_POLICY_MESSAGE })
  @Matches(/[0-9]/, { message: PASSWORD_POLICY_MESSAGE })
  password!: string;
}

export class InviteUserDto {
  @IsString()
  @IsNotEmpty({ message: 'userId is required.' })
  userId!: string;
}
