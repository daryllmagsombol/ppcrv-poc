import { IsOptional, IsString, IsIn, Matches } from 'class-validator';

export class ResultQueryDto {
  @IsString()
  @IsIn(['national', 'region', 'province', 'municipality', 'barangay', 'precinct'])
  level!: string;

  @IsOptional()
  @IsString()
  reg?: string;

  @IsOptional()
  @IsString()
  prv?: string;

  @IsOptional()
  @IsString()
  mun?: string;

  @IsOptional()
  @IsString()
  brgy?: string;

  @IsOptional()
  @IsString()
  vc?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'contest must be a numeric code' })
  contest?: string;

  @IsOptional()
  @IsIn(['true'])
  national_only?: string; // 'true' or undefined
}
