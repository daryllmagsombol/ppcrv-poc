import { IsOptional, IsString, Matches } from 'class-validator';

export class UndervotesQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{8}$/, { message: 'contest must be an 8-digit code' })
  contest?: string;

  @IsOptional()
  @IsString()
  reg?: string;

  @IsOptional()
  @IsString()
  prv?: string;

  @IsOptional()
  @IsString()
  mun?: string;
}
