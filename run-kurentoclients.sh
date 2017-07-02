# kurento-rtp-client (c) 2016-2017 Mario Gasparoni Junior
#
# Freely distributed under the MIT license
#
#!/bin/bash
#Connect a kurentoclient with audio/video in the given mcu room.
#This uses kurentoclient (https://github.com/mariogasparoni/kurento-tutorial-node/kurentoclient)
#usage:
#   ./run-kurentoclients.sh <ROOM_ID> <NUMBER_OF_INSTANCES> <VIDEO_FILE1>
#     <VIDEO_FILE2> ...
#
#   where SERVER is the server's address/hostname and  ROOM_ID is a
#   the remote use, NUMBER_OF_INSTANCES is the number of running instances and
#   VIDEO_FILE1, VIDEO_FILE2, ... is the path to a video file to be used as
#   input.

KURENTO_CLIENT_PATH='node server'
ROOM_ID=$1
NUMBER_OF_INSTANCES=$2
DELAY=2
SLEEP_TIME=$DELAY

trap 'kill -2 $(jobs -p);exit' INT

if test $2 -le 0
then
  echo "Error: number of instances must be greater than 0 ...";
  exit 1
fi

if test -z "$3"
then
    echo "Error: you must specify at least one video file ..."
    exit 1
fi

shift 2;

for INPUT_FILE in "$@"
do
  if ! test -e "$INPUT_FILE"
  then
      echo "Error: File \"$INPUT_FILE\" not found ..."
      exit 1
  fi
done

files_number=$#;
files_counter=1;


for i in `seq $NUMBER_OF_INSTANCES`
do
    INPUT_FILE=${!files_counter};

    if test $files_counter -ge $files_number
    then
      files_counter=1
    else
      files_counter=$((files_counter+1))
    fi

    (sleep $SLEEP_TIME;$KURENTO_CLIENT_PATH node server --room_id $ROOM_ID --input_video $INPUT_FILE) &
    SLEEP_TIME=$(($SLEEP_TIME+$DELAY))
done
wait
