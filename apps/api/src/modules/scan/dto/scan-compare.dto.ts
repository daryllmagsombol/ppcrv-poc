import { IsString, IsOptional } from 'class-validator';

export class ScanCompareDto {
  @IsString()
  precinct_id!: string;

  @IsOptional()
  @IsString()
  qr_raw_1?: string;

  @IsOptional()
  @IsString()
  qr_raw_2?: string;

  @IsOptional()
  @IsString()
  qr_raw_3?: string;
}
