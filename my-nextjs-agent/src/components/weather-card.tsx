'use client'

import type { ReactNode } from 'react'
import { CloudSunIcon, DropletIcon, WindIcon } from 'lucide-react'

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'

export type WeatherCardData = {
  temperature: number
  feelsLike: number
  humidity: number
  windSpeed: number
  windGust: number
  conditions: string
  location: string
}

export function WeatherCard({ data, children }: { data: WeatherCardData; children?: ReactNode }) {
  return (
    <Card size="sm" className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{data.location}</CardTitle>
        <CardDescription>{data.conditions}</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <CloudSunIcon className="size-8 text-muted-foreground" />
          <span className="font-semibold text-3xl">{Math.round(data.temperature)}°C</span>
        </div>
        <div className="space-y-1 text-muted-foreground text-xs">
          <div>Feels like {Math.round(data.feelsLike)}°C</div>
          <div className="flex items-center gap-1">
            <DropletIcon className="size-3.5" />
            {data.humidity}% humidity
          </div>
          <div className="flex items-center gap-1">
            <WindIcon className="size-3.5" />
            {Math.round(data.windSpeed)} km/h wind
          </div>
        </div>
      </CardContent>
      {children && <CardFooter className="justify-end">{children}</CardFooter>}
    </Card>
  )
}

export function WeatherCardLoading({ location }: { location?: string }) {
  return (
    <Card size="sm" className="w-full max-w-sm">
      <CardContent className="flex items-center gap-2 text-muted-foreground text-sm">
        <Spinner />
        Getting weather{location ? ` for ${location}` : ''}...
      </CardContent>
    </Card>
  )
}

export function WeatherCardError({ message }: { message?: string }) {
  return (
    <Card size="sm" className="w-full max-w-sm border border-destructive/40">
      <CardContent className="text-destructive text-sm">{message || 'Failed to fetch weather.'}</CardContent>
    </Card>
  )
}
