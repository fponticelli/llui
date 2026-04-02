port module Main exposing (main)

import Browser
import Html exposing (..)
import Html.Attributes exposing (..)
import Html.Events exposing (..)
import Html.Keyed as Keyed
import Html.Lazy exposing (lazy2)
import Json.Decode as Decode


port benchReady : () -> Cmd msg
port runOp : (String -> msg) -> Sub msg


type alias Row =
    { id : Int
    , label : String
    }


type alias Model =
    { rows : List Row
    , selected : Int
    , nextId : Int
    , lastLabel : Int
    }


type Msg
    = RunOp String
    | Select Int
    | Remove Int


adjectives : List String
adjectives =
    [ "pretty", "large", "big", "small", "tall", "short", "long", "nice", "quick" ]


nouns : List String
nouns =
    [ "table", "chair", "house", "mouse", "car", "bike", "tree", "bird", "fish" ]


listAt : Int -> List a -> Maybe a
listAt idx list =
    List.head (List.drop idx list)


buildLabel : Int -> String
buildLabel n =
    let
        adj = listAt (modBy 9 n) adjectives |> Maybe.withDefault ""
        noun = listAt (modBy 9 n) nouns |> Maybe.withDefault ""
    in
    adj ++ " " ++ noun


buildData : Int -> Int -> ( List Row, Int )
buildData count startId =
    let
        ids = List.range startId (startId + count - 1)
        rows = List.map (\id -> { id = id, label = buildLabel id }) ids
    in
    ( rows, startId + count )


init : () -> ( Model, Cmd Msg )
init _ =
    ( { rows = [], selected = -1, nextId = 1, lastLabel = 0 }
    , benchReady ()
    )


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        RunOp op ->
            case op of
                "run" ->
                    let
                        ( rows, nextId ) = buildData 1000 model.nextId
                    in
                    ( { model | rows = rows, nextId = nextId }, Cmd.none )

                "runlots" ->
                    let
                        ( rows, nextId ) = buildData 10000 model.nextId
                    in
                    ( { model | rows = rows, nextId = nextId }, Cmd.none )

                "add" ->
                    let
                        ( newRows, nextId ) = buildData 1000 model.nextId
                    in
                    ( { model | rows = model.rows ++ newRows, nextId = nextId }, Cmd.none )

                "update" ->
                    let
                        updateRow idx row =
                            if modBy 10 idx == 0 then
                                { row | label = row.label ++ " !!!" }
                            else
                                row
                    in
                    ( { model | rows = List.indexedMap updateRow model.rows }, Cmd.none )

                "clear" ->
                    ( { model | rows = [], selected = -1 }, Cmd.none )

                "swap" ->
                    case ( listAt 1 model.rows, listAt 998 model.rows ) of
                        ( Just r1, Just r998 ) ->
                            let
                                swapRow idx row =
                                    if idx == 1 then r998
                                    else if idx == 998 then r1
                                    else row
                            in
                            ( { model | rows = List.indexedMap swapRow model.rows }, Cmd.none )

                        _ ->
                            ( model, Cmd.none )

                "select" ->
                    case model.rows of
                        first :: _ ->
                            ( { model | selected = first.id }, Cmd.none )
                        [] ->
                            ( model, Cmd.none )

                "remove" ->
                    case model.rows of
                        first :: _ ->
                            ( { model | rows = List.filter (\r -> r.id /= first.id) model.rows }, Cmd.none )
                        [] ->
                            ( model, Cmd.none )

                "replace" ->
                    let
                        ( rows, nextId ) = buildData 1000 model.nextId
                    in
                    ( { model | rows = rows, nextId = nextId }, Cmd.none )

                _ ->
                    ( model, Cmd.none )

        Select id ->
            ( { model | selected = id }, Cmd.none )

        Remove id ->
            ( { model | rows = List.filter (\r -> r.id /= id) model.rows }, Cmd.none )


viewRow : Int -> Row -> ( String, Html Msg )
viewRow selected row =
    ( String.fromInt row.id
    , tr [ classList [ ( "selected", row.id == selected ) ] ]
        [ td [] [ text (String.fromInt row.id) ]
        , td [] [ span [ class "lbl", onClick (Select row.id) ] [ text row.label ] ]
        , td [] [ button [ class "remove", onClick (Remove row.id) ] [ text "x" ] ]
        ]
    )


view : Model -> Html Msg
view model =
    table []
        [ Keyed.node "tbody"
            []
            (List.map (viewRow model.selected) model.rows)
        ]


subscriptions : Model -> Sub Msg
subscriptions _ =
    runOp RunOp


main : Program () Model Msg
main =
    Browser.element
        { init = init
        , update = update
        , view = view
        , subscriptions = subscriptions
        }
