import { Fragment } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from '@/components/ui/item';

const videos = [
  {
    title: 'U16 vs Riverside, second half',
    meta: '42 min, 1080p',
    status: 'Ready',
    shade: 'bg-foreground/20',
  },
  {
    title: 'Cup semi-final',
    meta: '96 min, uploaded by the coach',
    status: 'Processing 64%',
    shade: 'bg-foreground/12',
  },
  {
    title: 'Tuesday training drills',
    meta: '18 min',
    status: 'Uploading',
    shade: 'bg-foreground/6',
  },
] as const;

export function PreviewVideoList() {
  return (
    <ItemGroup className="gap-0">
      {videos.map((video, index) => (
        <Fragment key={video.title}>
          {index > 0 && <ItemSeparator className="my-0" />}
          <Item size="xs" className="px-1 py-2.5">
            <ItemMedia className={`h-9 w-16 rounded-md ${video.shade}`} />
            <ItemContent className="min-w-0">
              <ItemTitle>{video.title}</ItemTitle>
              <ItemDescription className="line-clamp-1">{video.meta}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Badge variant={video.status === 'Ready' ? 'default' : 'secondary'}>
                {video.status}
              </Badge>
            </ItemActions>
          </Item>
        </Fragment>
      ))}
    </ItemGroup>
  );
}
